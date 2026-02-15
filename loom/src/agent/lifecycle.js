// ═══════════════════════════════════════════════════════════════════════════
// AGENT MANAGEMENT — createAgent, updateAgentUI, selectAgent, killAgent
// ═══════════════════════════════════════════════════════════════════════════

import { Agent, McpClient, StreamableHTTPClientTransport } from '../vendor/strands.js';
import { state, DEFAULT_MAX_TOKENS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS, DEFAULT_MODELS } from '../state/store.js';
import { createModel, detectProvider, providerReady } from '../models/providers.js';
import { showToast } from '../ui/toast.js';
import { TOOLS } from '../tools/registry.js';
import { buildCustomTools } from '../tools/self-mod.js';
import { renderMessages, updateRingUI } from '../ui/messages.js';
import { updateActivityFilterOptions } from '../ui/activity.js';
import { getActivePipeline } from '../ui/pipeline.js';
import { saveState } from '../sync/persistence.js';

export function buildSystemPrompt(agentId, basePrompt) {
    return `${basePrompt}

## Multi-Agent Context
You are agent "${agentId}" in a multi-agent system. You have access to:
- use_agent: Create sub-agents for parallel tasks
- scheduler: Schedule tasks (once or recurring cron)
- invoke_agent: Call another agent and wait for response
- broadcast_to_agents: Send message to all agents
- list_agents: Discover all available agents

## Self-Modification
- update_self: Modify your own system prompt
- create_tool: Create new tools at runtime
- list_tools: See all available tools
- delete_tool: Remove custom tools

Ring Attention: Other agents' recent messages are shared with you for context.

${getRingContext()}`;
}

export function getRingContext() {
    if (state.ringBuffer.length === 0) return '';
    const recent = state.ringBuffer.slice(-10);
    return '## Recent Messages from Other Agents:\n' + recent.map(e => `[${e.agentId}]: ${e.content.slice(0, 200)}...`).join('\n');
}

export async function connectMcpServers(mcpServers) {
    const clients = [], toolNames = [], tools = [];
    for (const srv of mcpServers) {
        try {
            const opts = srv.bearerToken ? { requestInit: { headers: { 'Authorization': `Bearer ${srv.bearerToken}` } } } : {};
            const transport = new StreamableHTTPClientTransport(srv.url, opts);
            const client = new McpClient({ transport });
            await client.connect();
            if (!srv.isAgentCore) {
                let mcpTools = await client.listTools();
                if (srv.toolFilter !== 'all') mcpTools = mcpTools.filter(t => srv.toolFilter.some(p => new RegExp(p).test(t.name)));
                toolNames.push(...mcpTools.map(t => t.name));
                tools.push(...mcpTools);
            }
            clients.push(client);
            showToast(`MCP: ${srv.isAgentCore ? 'gateway' : tools.length + ' tools'} from ${new URL(srv.url).hostname}`);
        } catch (e) { console.warn('MCP connect failed:', srv.url, e); showToast(`MCP failed: ${e.message}`); }
    }
    return { clients, toolNames, tools };
}

export function updateAgentUI() {
    const agentListHtml = [];
    const targetOptions = ['<option value="all">All Agents</option>'];
    const pipeline = getActivePipeline();

    for (const [id, data] of state.agents) {
        const isActive = id === state.activeAgentId;
        let statusText = data.status;
        if (data.status === 'processing' && pipeline) {
            const task = pipeline.tasks.find(t => t.assignedTo === id && t.status === 'working');
            if (task) statusText = '▶ ' + (task.id.length > 16 ? task.id.substring(0, 16) + '…' : task.id);
        }
        agentListHtml.push(`
            <div class="agent-card ${isActive ? 'active' : ''}" onclick="selectAgent('${id}')">
                <div class="agent-card-header">
                    <span class="agent-dot" style="background:${data.color}"></span>
                    <span class="agent-name">${id}</span>
                    <span class="agent-status ${data.status}">${statusText}</span>
                </div>
                <div class="agent-meta">
                    <span>${data.config.provider}${data.mcpToolNames?.length ? ` · ${data.mcpToolNames.length} mcp` : ''}</span>
                    <span>
                        <span class="agent-edit" onclick="openEditAgentModal('${id}', event)" title="Edit agent">✎</span>
                        <span class="agent-kill" onclick="killAgent('${id}', event)" title="Kill agent">✕</span>
                    </span>
                </div>
            </div>
        `);
        targetOptions.push(`<option value="${id}">${id}</option>`);
    }

    // Remote mesh agents
    if (window.AgentMesh?.getRemoteMeshAgents) {
        for (const a of window.AgentMesh.getRemoteMeshAgents()) {
            agentListHtml.push(`<div class="agent-card" style="opacity:0.6;cursor:default"><div class="agent-card-header"><span class="agent-dot" style="background:#ff9500"></span><span class="agent-name">🌐 ${a.agentId}</span><span class="agent-status ready">${a.pageLabel || 'mesh'}</span></div><div class="agent-meta"><span>${a.agentType || 'remote'}</span></div></div>`);
        }
    }

    document.getElementById('agentList').innerHTML = agentListHtml.join('') || '<div style="font-size:11px;color:var(--text-tertiary);">No agents yet</div>';
    document.getElementById('mobileAgentList').innerHTML = agentListHtml.join('') || '<div style="font-size:11px;color:var(--text-tertiary);">No agents yet</div>';
    document.getElementById('targetAgent').innerHTML = targetOptions.join('');
    updateActivityFilterOptions();

    const scheduleAgentSelect = document.getElementById('scheduleAgent');
    if (scheduleAgentSelect) scheduleAgentSelect.innerHTML = [...state.agents.keys()].map(id => `<option value="${id}">${id}</option>`).join('');
}

export function selectAgent(agentId) {
    state.activeAgentId = agentId;
    updateAgentUI();
    renderMessages();
    const agentData = state.agents.get(agentId);
    if (agentData) {
        document.getElementById('currentAgentName').textContent = agentId;
        document.getElementById('currentAgentModel').textContent = `${agentData.config.provider} • ${agentData.config.modelId || 'default'}`;
    }
    const sel = document.getElementById('targetAgent');
    if (sel && sel.querySelector(`option[value="${agentId}"]`)) sel.value = agentId;
}

export function killAgent(agentId, event) {
    event.stopPropagation();
    if (!confirm(`Kill agent ${agentId}?`)) return;
    const agentData = state.agents.get(agentId);
    if (agentData?.mcpClients) { for (const c of agentData.mcpClients) c.disconnect().catch(() => {}); }
    state.agents.delete(agentId);
    if (state.activeAgentId === agentId) state.activeAgentId = state.agents.keys().next().value || null;
    updateAgentUI(); renderMessages();
    showToast(`Agent ${agentId} killed`);
    saveState();
}

export async function autoCreateDefaultAgent() {
    if (state.agents.size > 0) return;
    const provider = detectProvider();
    try {
        const modelConfig = { maxTokens: DEFAULT_MAX_TOKENS, additionalRequestFields: provider === 'bedrock' ? DEFAULT_BEDROCK_ADDITIONAL_FIELDS : null };
        const model = createModel(provider, modelConfig);
        const customTools = buildCustomTools();
        const allTools = [...TOOLS, ...customTools];
        const agent = new Agent({ model, tools: allTools, systemPrompt: buildSystemPrompt('assistant', 'You are AGI, a helpful AI assistant. You can spawn sub-agents, schedule tasks, create custom tools, and coordinate with other agents.'), printer: false });
        const color = state.agentColors[state.colorIndex % state.agentColors.length];
        state.colorIndex++;
        state.agents.set('assistant', { agent, model, config: { provider, systemPrompt: 'You are AGI, a helpful AI assistant. You can spawn sub-agents, schedule tasks, create custom tools, and coordinate with other agents.', maxTokens: DEFAULT_MAX_TOKENS, additionalRequestFields: provider === 'bedrock' ? DEFAULT_BEDROCK_ADDITIONAL_FIELDS : null }, messages: [], status: 'ready', color });
        state.activeAgentId = 'assistant';
        updateAgentUI(); renderMessages(); saveState();
        showToast('Default agent ready');
    } catch (e) { console.warn('Could not auto-create default agent:', e); }
}
