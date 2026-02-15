// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE — saveState, loadState, export/import agents
// ═══════════════════════════════════════════════════════════════════════════

import { Agent } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { createModel, providerReady, detectProvider } from '../models/providers.js';
import { showToast } from '../ui/toast.js';
import { TOOLS } from '../tools/registry.js';
import { buildCustomTools } from '../tools/self-mod.js';
import { buildSystemPrompt, connectMcpServers, updateAgentUI } from '../agent/lifecycle.js';
import { updateRingUI, renderMessages } from '../ui/messages.js';

export function saveState() {
    const data = { credentials: state.credentials, agents: [], ringBuffer: state.ringBuffer.slice(-50) };
    for (const [id, agentData] of state.agents) {
        data.agents.push({ id, config: agentData.config, messages: agentData.messages.slice(-50), color: agentData.color });
    }
    localStorage.setItem('agi_multi_state', JSON.stringify(data));
}

export async function loadState() {
    try {
        const stored = localStorage.getItem('agi_multi_state');
        if (!stored) return;
        const data = JSON.parse(stored);
        state.credentials = data.credentials || state.credentials;
        state.ringBuffer = data.ringBuffer || [];

        for (const agentData of data.agents || []) {
            try {
                const provider = providerReady(agentData.config.provider) ? agentData.config.provider : detectProvider();
                const model = createModel(provider, agentData.config);
                const allTools = [...TOOLS, ...buildCustomTools()];
                let mcpClients = [], mcpToolNames = [];
                if (agentData.config.mcpServers?.length) {
                    const result = await connectMcpServers(agentData.config.mcpServers);
                    mcpClients = result.clients; mcpToolNames = result.toolNames; allTools.push(...result.tools);
                }
                const agent = new Agent({ model, tools: allTools, systemPrompt: buildSystemPrompt(agentData.id, agentData.config.systemPrompt), printer: false });
                state.agents.set(agentData.id, { agent, model, config: agentData.config, mcpClients, mcpToolNames, messages: agentData.messages || [], status: 'ready', color: agentData.color || state.agentColors[state.colorIndex++ % state.agentColors.length] });
            } catch (e) { console.warn(`Failed to restore agent ${agentData.id}:`, e); }
        }
        if (state.agents.size > 0) state.activeAgentId = state.agents.keys().next().value;
    } catch (e) { console.warn('Failed to load state:', e); }
}

export function exportAllAgents() {
    const data = { version: 1, exported: new Date().toISOString(), credentials: state.credentials, agents: [], ringBuffer: state.ringBuffer };
    for (const [id, agentData] of state.agents) data.agents.push({ id, config: agentData.config, messages: agentData.messages, color: agentData.color });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `loom-export-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('State exported');
}

export async function importAgents(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        state.credentials = data.credentials || state.credentials;
        state.ringBuffer = data.ringBuffer || [];
        for (const agentData of data.agents || []) {
            if (state.agents.has(agentData.id)) continue;
            const provider = providerReady(agentData.config.provider) ? agentData.config.provider : detectProvider();
            const model = createModel(provider, agentData.config);
            const agent = new Agent({ model, tools: TOOLS, systemPrompt: buildSystemPrompt(agentData.id, agentData.config.systemPrompt), printer: false });
            state.agents.set(agentData.id, { agent, model, config: agentData.config, messages: agentData.messages || [], status: 'ready', color: agentData.color || state.agentColors[state.colorIndex++ % state.agentColors.length] });
        }
        updateAgentUI(); updateRingUI(); saveState();
        showToast('State imported');
    } catch (e) { showToast('Import failed: ' + e.message); }
    event.target.value = '';
}

export function clearAllData() {
    if (!confirm('Clear all agents and data?')) return;
    localStorage.removeItem('agi_multi_state');
    location.reload();
}
