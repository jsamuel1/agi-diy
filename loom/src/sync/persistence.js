// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE — saveState, loadState, export/import agents
// ═══════════════════════════════════════════════════════════════════════════
// Credentials live in localStorage (small, cross-tab sync via storage events).
// Everything else (agents, messages, ring buffer, pipelines, sandboxes,
// custom tools) lives in IndexedDB — no size limit, per-agent records.

import { state } from '../state/store.js';
import { showToast } from '../ui/toast.js';
import { ensureAgent, connectMcpServers, updateAgentUI } from '../agent/lifecycle.js';
import { updateRingUI, renderMessages } from '../ui/messages.js';
import { getPipelines, savePipelines } from '../ui/pipeline.js';
import * as db from './db.js';

// ─── Save state (fire-and-forget IDB write with coalescing) ───

let _saving = false;
let _saveQueued = false;

export function saveState() {
    // Credentials stay in localStorage — small, and cross-tab sync relies on storage events
    try {
        localStorage.setItem('agi_credentials', JSON.stringify(state.credentials));
    } catch (e) {
        console.warn('[loom] Failed to save credentials to localStorage:', e);
    }

    // Coalesce IDB writes — only one in-flight at a time, last-wins
    if (_saving) { _saveQueued = true; return; }
    _saving = true;
    _flushToIDB()
        .catch(e => console.warn('[loom] IDB save failed:', e))
        .finally(() => {
            _saving = false;
            if (_saveQueued) { _saveQueued = false; saveState(); }
        });
}

async function _flushToIDB() {
    const agents = [];
    for (const [id, data] of state.agents) {
        agents.push({ id, config: data.config, messages: data.messages, color: data.color });
    }
    // Write agents + pipelines + ring buffer in one IDB transaction for consistency (#9)
    await db.saveAll(agents, {
        ringBuffer: state.ringBuffer,
        pipelines: getPipelines(),
    });
}

// ─── Load state (async, called once at startup) ───

export async function loadState() {
    try {
        await db.openDB();

        // 1. Load credentials from localStorage
        const credStr = localStorage.getItem('agi_credentials');
        if (credStr) {
            try {
                const creds = JSON.parse(credStr);
                state.credentials = { ...state.credentials, ...creds };
            } catch {}
        }

        // 2. Migrate from old localStorage format if present
        const oldState = localStorage.getItem('agi_multi_state');
        if (oldState) {
            await _migrateFromLocalStorage(JSON.parse(oldState));
            localStorage.removeItem('agi_multi_state');
        }

        // 3. Load agents from IndexedDB
        const agents = await db.getAllAgents();
        state.ringBuffer = (await db.getMeta('ringBuffer')) || [];

        for (const agentData of agents) {
            try {
                const color = agentData.color || state.agentColors[state.colorIndex++ % state.agentColors.length];
                let mcpClients = [], mcpToolNames = [];
                if (agentData.config.mcpServers?.length) {
                    const result = await connectMcpServers(agentData.config.mcpServers);
                    mcpClients = result.clients; mcpToolNames = result.toolNames;
                }
                state.agents.set(agentData.id, {
                    agent: null, model: null, config: agentData.config,
                    _configHash: null, mcpClients, mcpToolNames,
                    messages: agentData.messages || [], status: 'ready', color
                });
                ensureAgent(agentData.id);
            } catch (e) { console.warn(`[loom] Failed to restore agent ${agentData.id}:`, e); }
        }
        if (state.agents.size > 0) state.activeAgentId = state.agents.keys().next().value;
    } catch (e) { console.warn('[loom] Failed to load state:', e); }
}

async function _migrateFromLocalStorage(data) {
    // Credentials
    if (data.credentials) {
        state.credentials = { ...state.credentials, ...data.credentials };
        localStorage.setItem('agi_credentials', JSON.stringify(state.credentials));
    }

    // Agents + ring buffer → IDB
    const agents = (data.agents || []).map(a => ({
        id: a.id, config: a.config, messages: a.messages || [], color: a.color
    }));
    const meta = {};
    if (data.ringBuffer) meta.ringBuffer = data.ringBuffer;

    // Also migrate other localStorage items that are moving to IDB
    try {
        const pipelines = localStorage.getItem('agi_pipelines');
        if (pipelines) { meta.pipelines = JSON.parse(pipelines); localStorage.removeItem('agi_pipelines'); }
    } catch {}
    try {
        const sandboxes = localStorage.getItem('agi_sandboxes');
        if (sandboxes) { meta.sandboxes = JSON.parse(sandboxes); localStorage.removeItem('agi_sandboxes'); }
    } catch {}
    try {
        const customTools = localStorage.getItem('agi_multi_custom_tools');
        if (customTools) { meta.customTools = JSON.parse(customTools); localStorage.removeItem('agi_multi_custom_tools'); }
    } catch {}

    await db.saveAll(agents, meta);
    console.log(`[loom] Migrated ${agents.length} agent(s) from localStorage to IndexedDB`);
}

// ─── Reconciliation — fix interrupted pipeline tasks on load (#9) ───

export function reconcilePipelineState() {
    const pipelines = getPipelines();
    let changed = false;
    for (const pipeline of Object.values(pipelines)) {
        for (const task of pipeline.tasks || []) {
            if (task.status === 'working') {
                // If the assigned agent exists and is ready (not processing), the task
                // was interrupted — reset to pending so it can be re-dispatched.
                const agentData = task.agentId ? state.agents.get(task.agentId) : null;
                if (!agentData || agentData.status === 'ready') {
                    console.log(`[loom] Reconciliation: task "${task.name}" was interrupted, resetting to pending`);
                    task.status = 'pending';
                    changed = true;
                }
            }
        }
    }
    if (changed) savePipelines(pipelines);
}

// ─── Export / Import ───

export function exportAllAgents() {
    const data = { version: 2, exported: new Date().toISOString(), credentials: state.credentials, agents: [], ringBuffer: state.ringBuffer };
    for (const [id, agentData] of state.agents) data.agents.push({ id, config: agentData.config, messages: agentData.messages, color: agentData.color });
    _download(JSON.stringify(data, null, 2), `loom-export-${Date.now()}.json`, 'application/json');
    showToast('State exported');
}

export function exportAgent(agentId, format = 'json') {
    const agentData = state.agents.get(agentId);
    if (!agentData) { showToast(`Agent "${agentId}" not found`); return; }

    if (format === 'markdown') {
        const md = _agentToMarkdown(agentId, agentData);
        _download(md, `${agentId}-${Date.now()}.md`, 'text/markdown');
    } else {
        const data = {
            version: 2, exported: new Date().toISOString(), agentId,
            config: agentData.config, messages: agentData.messages, color: agentData.color
        };
        _download(JSON.stringify(data, null, 2), `${agentId}-${Date.now()}.json`, 'application/json');
    }
    showToast(`Exported "${agentId}" as ${format}`);
}

function _agentToMarkdown(agentId, agentData) {
    const lines = [`# Agent: ${agentId}`, `Exported: ${new Date().toISOString()}`, `Provider: ${agentData.config.provider}`, ''];
    if (agentData.config.systemPrompt) {
        lines.push('## System Prompt', '```', agentData.config.systemPrompt, '```', '');
    }
    lines.push('## Conversation', '');
    for (const msg of agentData.messages) {
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
        if (msg.role === 'user') {
            lines.push(`### User ${time}`, '', msg.content, '');
        } else if (msg.role === 'assistant') {
            lines.push(`### Assistant ${time}`, '');
            if (msg.transcript?.length) {
                for (const entry of msg.transcript) {
                    if (entry.type === 'text') {
                        lines.push(entry.content, '');
                    } else if (entry.type === 'tool_use') {
                        lines.push(`**Tool: ${entry.name}**`, '```json', JSON.stringify(entry.input, null, 2), '```', '');
                    } else if (entry.type === 'tool_result') {
                        const out = typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output, null, 2);
                        lines.push(`**Result** (${entry.status}):`, '```', out.slice(0, 2000), '```', '');
                    }
                }
            } else if (msg.content) {
                lines.push(msg.content, '');
            }
        }
    }
    return lines.join('\n');
}

function _download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
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
            const color = agentData.color || state.agentColors[state.colorIndex++ % state.agentColors.length];
            state.agents.set(agentData.id, {
                agent: null, model: null, config: agentData.config,
                _configHash: null, mcpClients: [], mcpToolNames: [],
                messages: agentData.messages || [], status: 'ready', color
            });
            ensureAgent(agentData.id);
        }
        updateAgentUI(); updateRingUI(); saveState();
        showToast('State imported');
    } catch (e) { showToast('Import failed: ' + e.message); }
    event.target.value = '';
}

export async function clearAllData() {
    if (!confirm('Clear all agents and data?')) return;
    localStorage.removeItem('agi_credentials');
    localStorage.removeItem('agi_multi_state'); // in case migration hadn't run
    await db.clearAll().catch(() => {});
    location.reload();
}
