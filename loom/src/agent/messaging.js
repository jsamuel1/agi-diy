// ═══════════════════════════════════════════════════════════════════════════
// MESSAGING — runAgentMessage, sendMessage, clearChat, broadcastMessage
// ═══════════════════════════════════════════════════════════════════════════

import { Agent } from '../vendor/strands.js';
import { state, DEFAULT_MAX_TOKENS } from '../state/store.js';
import { createModel, providerReady, detectProvider } from '../models/providers.js';
import { showToast } from '../ui/toast.js';
import { addMessageToUI, addThinking, removeThinking, updateStreaming, finalizeStreaming, streamingEls, updateRingUI, renderMessages } from '../ui/messages.js';
import { addToolCall, updateToolStatus } from '../ui/messages.js';
import { appendActivityFeed, activityLog, renderActivityEntry } from '../ui/activity.js';
import { transcriptPushText, transcriptFullText, transcriptLastText } from '../agent/transcript.js';
import { updatePipelineUI } from '../ui/pipeline.js';
import { TOOLS } from '../tools/registry.js';
import { buildCustomTools } from '../tools/self-mod.js';
import { buildSystemPrompt, updateAgentUI, autoCreateDefaultAgent } from './lifecycle.js';
import { SummarizingManager, InterruptHook, queueInterrupt } from './hooks.js';
import { saveState } from '../sync/persistence.js';

export let broadcastMode = false;
export const abortControllers = new Map();

export async function runAgentMessage(agentId, message) {
    const agentData = state.agents.get(agentId);
    if (!agentData) return;

    // Validate credentials before attempting model call
    if (!providerReady(agentData.config.provider)) {
        addMessageToUI('error', `No credentials configured for ${agentData.config.provider}. Open Settings to add them.`, agentId, agentData.color);
        return;
    }

    if (abortControllers.has(agentId)) abortControllers.get(agentId).abort();
    const ac = new AbortController();
    abortControllers.set(agentId, ac);

    state.ringBuffer.push({ agentId, role: 'user', content: message, timestamp: Date.now() });
    if (state.ringBuffer.length > 100) state.ringBuffer.shift();
    updateRingUI();

    let activeAgent;
    try {
        const provider = providerReady(agentData.config.provider) ? agentData.config.provider : detectProvider();
        const model = createModel(provider, {
            modelId: agentData.config.modelId,
            maxTokens: agentData.config.maxTokens || DEFAULT_MAX_TOKENS,
            additionalRequestFields: agentData.config.additionalRequestFields || null
        });
        const enabledTools = agentData.config.enabledTools;
        const selectedTools = (!enabledTools || enabledTools === null) ? TOOLS : TOOLS.filter(t => enabledTools.includes(t.name));
        const customTools = buildCustomTools();
        const allTools = [...selectedTools, ...customTools];

        activeAgent = new Agent({
            model, tools: allTools,
            systemPrompt: buildSystemPrompt(agentId, agentData.config.systemPrompt),
            printer: false,
            conversationManager: new SummarizingManager(),
            hooks: [new InterruptHook()]
        });

        if (agentData.config.toolChoice) {
            const origStream = model.stream.bind(model);
            model.stream = function(msgs, opts) { return origStream(msgs, { ...opts, toolChoice: agentData.config.toolChoice }); };
        }

        if (agentData.messages.length > 0) {
            const recentHistory = agentData.messages.slice(-20);
            for (const msg of recentHistory) {
                const text = msg.content || (msg.transcript ? transcriptFullText(msg.transcript) : '');
                activeAgent.messages.push({ role: msg.role, content: [{ type: 'textBlock', text }] });
            }
        }
    } catch (e) {
        addMessageToUI('error', `Failed to create agent: ${e.message}`, agentId, agentData.color);
        return;
    }

    agentData.status = 'processing';
    updateAgentUI();

    agentData.messages.push({ role: 'user', content: message, timestamp: Date.now() });
    const shouldShow = broadcastMode || agentId === state.activeAgentId;
    if (shouldShow) { addMessageToUI('user', message, agentId, agentData.color); addThinking(); }

    try {
        let currentText = '';
        const transcript = [];
        const watchdog = setTimeout(() => {
            ac.abort(); agentData.status = 'error'; abortControllers.delete(agentId);
            document.getElementById('interruptBtn').style.display = 'none';
            if (shouldShow) { removeThinking(); addMessageToUI('error', 'Agent timed out (5 min)', agentId, agentData.color); }
            appendActivityFeed(agentId, '❌ Timed out after 5 minutes', 'msg');
            updateAgentUI(); saveState();
        }, 300000);

        for await (const event of activeAgent.stream(message)) {
            if (ac.signal.aborted) break;
            if (!event?.type) continue;

            if (event.type === 'modelContentBlockDeltaEvent' && event.delta?.type === 'textDelta') {
                currentText += event.delta.text;
                transcriptPushText(transcript, event.delta.text);
                if (shouldShow) updateStreaming(currentText, agentId, agentData.color);
            } else if (event.type === 'beforeToolCallEvent') {
                const toolId = event.toolUse?.toolUseId || `tool-${event.toolUse?.name}-${Date.now()}`;
                transcript.push({ type: 'tool_use', name: event.toolUse?.name, toolId, input: event.toolUse?.input });
                if (shouldShow) {
                    addToolCall(event.toolUse?.name, event.toolUse?.input, 'running', toolId);
                    const se = streamingEls.get(agentId);
                    if (se) document.getElementById('messagesInner').appendChild(se);
                }
                const toolName = event.toolUse?.name, toolInput = event.toolUse?.input;
                const feedLabel = toolName === 'invoke_agent' && toolInput?.targetAgentId ? `🔧 invoke_agent → ${toolInput.targetAgentId}` : `🔧 ${toolName}`;
                appendActivityFeed(agentId, feedLabel, 'tool', { input: toolInput });
            } else if (event.type === 'afterToolCallEvent') {
                transcript.push({ type: 'tool_result', name: event.toolUse?.name, toolId: event.toolUse?.toolUseId, status: event.result?.status || 'success', output: event.result });
                if (shouldShow) updateToolStatus(event.toolUse?.toolUseId, event.toolUse?.name, event.result?.status || 'success', event.result);
                const last = activityLog.findLast(e => e.type === 'tool' && e.agentId === agentId);
                if (last && event.result) { last.extra = { ...last.extra, output: event.result }; const feed = document.getElementById('activityFeed'); if (feed) renderActivityEntry(feed, last); }
            }
        }

        if (shouldShow) { removeThinking(); if (currentText) finalizeStreaming(currentText, agentId, agentData.color); }
        if (currentText) appendActivityFeed(agentId, currentText.replace(/[#*`]/g, '').substring(0, 1000));

        agentData.messages.push({ role: 'assistant', transcript, content: currentText, timestamp: Date.now() });
        state.ringBuffer.push({ agentId, role: 'assistant', content: currentText, timestamp: Date.now() });
        if (window.AgentMesh?.addToRingContext) window.AgentMesh.addToRingContext(agentId, 'multi', currentText.slice(0, 500));
        if (state.ringBuffer.length > 100) state.ringBuffer.shift();
        updateRingUI();

        agentData.status = 'ready';
        abortControllers.delete(agentId);
        clearTimeout(watchdog);
        document.getElementById('interruptBtn').style.display = 'none';
        return currentText;
    } catch (e) {
        agentData.status = 'error'; abortControllers.delete(agentId);
        document.getElementById('interruptBtn').style.display = 'none';
        if (shouldShow) { removeThinking(); addMessageToUI('error', e.message, agentId, agentData.color); }
        appendActivityFeed(agentId, `❌ Error: ${e.message}`, 'msg');
    }
    updateAgentUI(); saveState();
}

export async function sendMessage() {
    const input = document.getElementById('inputField');
    const text = input.value.trim();
    if (!text) return;
    document.getElementById('interruptBtn').style.display = 'inline-flex';
    const target = document.getElementById('targetAgent').value;

    if (state.agents.size === 0) {
        const hasAnyCreds = Object.keys(state.credentials).some(p => providerReady(p));
        if (!hasAnyCreds) { showToast('Add API key in Settings first'); window.openSettingsModal(); return; }
        showToast('Creating agent...'); await autoCreateDefaultAgent();
        if (state.agents.size === 0) { showToast('Failed to create agent'); return; }
    }

    input.value = '';
    broadcastMode = (target === 'all');
    if (target === 'all') { for (const agentId of state.agents.keys()) runAgentMessage(agentId, text); }
    else runAgentMessage(target, text);
}

export function broadcastMessagePrompt() {
    broadcastMode = true;
    const text = prompt('Broadcast message to all agents:');
    if (text?.trim()) { for (const agentId of state.agents.keys()) runAgentMessage(agentId, text.trim()); }
}

export function clearChat() {
    for (const [, ac] of abortControllers) ac.abort();
    abortControllers.clear();
    for (const [, data] of state.agents) data.status = 'ready';
    updateAgentUI();
    localStorage.removeItem('agi_pipelines'); updatePipelineUI();
    if (!state.activeAgentId) { showToast('Cleared'); return; }
    const agentData = state.agents.get(state.activeAgentId);
    if (agentData) {
        agentData.messages = [];
        renderMessages();
        showToast('Cleared'); saveState();
    }
}

export function clearAllChats() {
    for (const [, ac] of abortControllers) ac.abort();
    abortControllers.clear();
    for (const [, data] of state.agents) { data.status = 'ready'; data.messages = []; }
    localStorage.removeItem('agi_pipelines'); updatePipelineUI(); updateAgentUI();
    renderMessages(); saveState(); showToast('All cleared');
}

export function sendInterrupt() {
    const input = document.getElementById('inputField');
    const text = input.value.trim();
    if (!text) return;
    const agentId = state.activeAgentId || 'main';
    queueInterrupt(agentId, text);
    addMessageToUI('user', `⚡ [Interrupt]: ${text}`, agentId);
    input.value = '';
}

export function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
