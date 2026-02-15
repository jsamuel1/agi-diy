// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — render_ui, javascript_eval, storage, fetch, notify, use_agent, scheduler
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { state, DEFAULT_MAX_TOKENS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS } from '../state/store.js';
import { scrollToBottom } from '../ui/toast.js';
import { showToast } from '../ui/toast.js';
import { createModel, providerReady, detectProvider } from '../models/providers.js';

// Forward references set by registry.js after all tools are assembled
let _runAgentMessage = null;
let _updateAgentUI = null;
let _updateScheduleUI = null;
let _saveState = null;
let _TOOLS = null;

export function setCoreCallbacks({ runAgentMessage, updateAgentUI, updateScheduleUI, saveState, getTools }) {
    _runAgentMessage = runAgentMessage;
    _updateAgentUI = updateAgentUI;
    _updateScheduleUI = updateScheduleUI;
    _saveState = saveState;
    _TOOLS = getTools;
}

export const renderUiTool = tool({
    name: 'render_ui',
    description: 'Render HTML/CSS/JS in the chat',
    inputSchema: z.object({ html: z.string(), css: z.string().optional(), script: z.string().optional(), title: z.string().optional() }),
    callback: async (input) => {
        const container = document.createElement('div');
        container.className = 'dynamic-ui';
        if (input.title) container.innerHTML = `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">${input.title}</div>`;
        if (input.css) container.innerHTML += `<style>${input.css}</style>`;
        container.innerHTML += input.html;
        document.getElementById('messagesInner').appendChild(container);
        scrollToBottom();
        if (input.script) { try { new Function(input.script).call(container); } catch (e) { return { error: e.message }; } }
        return { rendered: true };
    }
});

export const javascriptEvalTool = tool({
    name: 'javascript_eval',
    description: 'Execute JavaScript',
    inputSchema: z.object({ code: z.string() }),
    callback: async (input) => { try { return { result: String(eval(input.code)) }; } catch (e) { return { error: e.message }; } }
});

export const storageGetTool = tool({
    name: 'storage_get',
    description: 'Get localStorage value',
    inputSchema: z.object({ key: z.string() }),
    callback: async (input) => ({ key: input.key, value: localStorage.getItem(input.key) })
});

export const storageSetTool = tool({
    name: 'storage_set',
    description: 'Set localStorage value',
    inputSchema: z.object({ key: z.string(), value: z.string() }),
    callback: async (input) => { localStorage.setItem(input.key, input.value); return { success: true }; }
});

export const fetchUrlTool = tool({
    name: 'fetch_url',
    description: 'HTTP request',
    inputSchema: z.object({ url: z.string(), method: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() }),
    callback: async (input) => {
        try {
            const r = await fetch(input.url, { method: input.method || 'GET', headers: input.headers, body: input.body });
            const ct = r.headers.get('content-type');
            const data = ct?.includes('json') ? await r.json() : await r.text();
            return { status: r.status, data };
        } catch (e) { return { error: e.message }; }
    }
});

export const notifyTool = tool({
    name: 'notify',
    description: 'Send browser notification',
    inputSchema: z.object({ title: z.string(), body: z.string() }),
    callback: async (input) => {
        if (Notification.permission === 'granted') { new Notification(input.title, { body: input.body }); return { success: true }; }
        return { error: 'Notifications not permitted' };
    }
});

export const useAgentTool = tool({
    name: 'use_agent',
    description: 'Create a sub-agent to handle a specific task. The sub-agent runs asynchronously.',
    inputSchema: z.object({
        agentId: z.string().describe('Unique ID for the sub-agent'),
        provider: z.enum(['anthropic', 'openai', 'bedrock']).describe('Model provider'),
        systemPrompt: z.string().describe('System prompt for sub-agent'),
        prompt: z.string().describe('Initial prompt to send'),
        maxTokens: z.number().optional()
    }),
    callback: async (input) => {
        try {
            if (state.agents.has(input.agentId)) return { error: `Agent ${input.agentId} already exists` };
            const { Agent } = await import('../vendor/strands.js');
            const provider = providerReady(input.provider) ? input.provider : detectProvider();
            const modelConfig = { maxTokens: input.maxTokens || DEFAULT_MAX_TOKENS };
            if (provider === 'bedrock') modelConfig.additionalRequestFields = DEFAULT_BEDROCK_ADDITIONAL_FIELDS;
            const model = createModel(provider, modelConfig);
            const subAgent = new Agent({
                model,
                tools: [renderUiTool, javascriptEvalTool, storageGetTool, storageSetTool, fetchUrlTool, notifyTool],
                systemPrompt: input.systemPrompt,
                printer: false
            });
            const color = state.agentColors[state.colorIndex % state.agentColors.length];
            state.colorIndex++;
            state.agents.set(input.agentId, {
                agent: subAgent, model,
                config: { provider: input.provider, systemPrompt: input.systemPrompt, maxTokens: input.maxTokens || DEFAULT_MAX_TOKENS, additionalRequestFields: input.provider === 'bedrock' ? DEFAULT_BEDROCK_ADDITIONAL_FIELDS : null },
                messages: [], status: 'ready', color
            });
            if (_updateAgentUI) _updateAgentUI();
            setTimeout(() => { if (_runAgentMessage) _runAgentMessage(input.agentId, input.prompt); }, 0);
            return { success: true, agentId: input.agentId, message: 'Sub-agent spawned and processing prompt' };
        } catch (e) { return { error: e.message }; }
    }
});

export const schedulerTool = tool({
    name: 'scheduler',
    description: 'Schedule a task to run once or on a recurring basis (cron pattern)',
    inputSchema: z.object({
        action: z.enum(['create', 'list', 'delete']),
        name: z.string().optional(), agentId: z.string().optional(), prompt: z.string().optional(),
        type: z.enum(['once', 'cron']).optional(), delay: z.number().optional(), cron: z.string().optional()
    }),
    callback: async (input) => {
        if (input.action === 'list') {
            const schedules = [];
            for (const [id, s] of state.schedules) schedules.push({ id, name: s.name, agentId: s.agentId, type: s.type, cron: s.cron, delay: s.delay });
            return { schedules };
        }
        if (input.action === 'delete') {
            if (!input.name) return { error: 'Name required for delete' };
            for (const [id, s] of state.schedules) {
                if (s.name === input.name) {
                    if (s.timer) clearTimeout(s.timer);
                    if (s.interval) clearInterval(s.interval);
                    state.schedules.delete(id);
                    if (_updateScheduleUI) _updateScheduleUI();
                    return { success: true, deleted: input.name };
                }
            }
            return { error: 'Schedule not found' };
        }
        if (input.action === 'create') {
            if (!input.name || !input.agentId || !input.prompt || !input.type) return { error: 'name, agentId, prompt, and type required' };
            if (!state.agents.has(input.agentId)) return { error: `Agent ${input.agentId} not found` };
            const id = `schedule-${Date.now()}`;
            const schedule = { name: input.name, agentId: input.agentId, prompt: input.prompt, type: input.type, delay: input.delay, cron: input.cron };
            if (input.type === 'once') {
                const delayMs = (input.delay || 60) * 1000;
                schedule.timer = setTimeout(() => { if (_runAgentMessage) _runAgentMessage(input.agentId, input.prompt); state.schedules.delete(id); if (_updateScheduleUI) _updateScheduleUI(); }, delayMs);
                schedule.runAt = new Date(Date.now() + delayMs).toISOString();
            } else if (input.type === 'cron') {
                const cronParts = (input.cron || '* * * * *').split(' ');
                let intervalMs = 60000;
                if (cronParts[0].startsWith('*/')) intervalMs = parseInt(cronParts[0].slice(2)) * 60000;
                schedule.interval = setInterval(() => { if (_runAgentMessage) _runAgentMessage(input.agentId, input.prompt); }, intervalMs);
            }
            state.schedules.set(id, schedule);
            if (_updateScheduleUI) _updateScheduleUI();
            if (_saveState) _saveState();
            return { success: true, scheduleId: id, name: input.name, type: input.type };
        }
        return { error: 'Invalid action' };
    }
});
