// ═══════════════════════════════════════════════════════════════════════════
// AGENT MANAGEMENT — createAgent, updateAgentUI, selectAgent, killAgent
// ═══════════════════════════════════════════════════════════════════════════

import { Agent, McpClient, StreamableHTTPClientTransport, SummarizingConversationManager } from '../vendor/strands.js';
import { state, DEFAULT_MAX_TOKENS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS } from '../state/store.js';
import { createModel, detectProvider, providerReady } from '../models/providers.js';
import { showToast } from '../ui/toast.js';
import { TOOLS } from '../tools/registry.js';
import { buildCustomTools } from '../tools/self-mod.js';
import { InterruptHook, RetryHook } from './hooks.js';
import { rebuildSDKMessages } from './transcript.js';
import { renderMessages } from '../ui/messages.js';
import { updateActivityFilterOptions } from '../ui/activity.js';
import { getActivePipeline } from '../ui/pipeline.js';
import { saveState } from '../sync/persistence.js';

// ─── Config hashing for change detection ───
export function computeConfigHash(config) {
    const key = JSON.stringify({
        provider: config.provider,
        modelId: config.modelId,
        systemPrompt: config.systemPrompt,
        maxTokens: config.maxTokens,
        additionalRequestFields: config.additionalRequestFields,
        enabledTools: config.enabledTools,
        toolChoice: config.toolChoice,
        mcpServers: config.mcpServers
    });
    // Simple djb2 hash — fast, deterministic, good enough for change detection
    let hash = 5381;
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
    return hash;
}

// ─── Ensure a live Agent instance exists (create or reuse) ───
export function ensureAgent(agentId) {
    const agentData = state.agents.get(agentId);
    if (!agentData) return null;

    const currentHash = computeConfigHash(agentData.config);
    const hasLiveAgent = agentData.agent && typeof agentData.agent.stream === 'function';

    if (hasLiveAgent && agentData._configHash === currentHash) {
        return agentData.agent; // Reuse — config hasn't changed
    }

    // (Re)create agent
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

    // Re-attach MCP tools if we have live clients
    if (agentData.mcpClients?.length) {
        // MCP tools were already resolved at spawn/edit time and stored on the agent data
        // We'll re-list them synchronously from cached tool names — the actual tool objects
        // are on the previous agent. For now, we keep MCP tools from the prior instance.
        // Full MCP tool re-resolution happens in spawnAgent/saveAgentEdit.
    }

    if (agentData.config.toolChoice) {
        const origStream = model.stream.bind(model);
        model.stream = function(msgs, opts) { return origStream(msgs, { ...opts, toolChoice: agentData.config.toolChoice }); };
    }

    const agent = new Agent({
        model,
        tools: allTools,
        systemPrompt: buildSystemPrompt(agentId, agentData.config.systemPrompt),
        printer: false,
        conversationManager: new SummarizingConversationManager({
            summaryRatio: 0.3,
            preserveRecentMessages: 10
        }),
        hooks: [new InterruptHook(), new RetryHook()]
    });

    agentData.agent = agent;
    agentData.model = model;
    agentData._configHash = currentHash;

    // Rehydrate stored conversation history into the SDK agent
    if (agentData.messages?.length) {
        const sdkMessages = rebuildSDKMessages(agentData.messages);
        agent.messages.push(...sdkMessages);
        console.log(`[loom] Injected ${sdkMessages.length} SDK messages for "${agentId}" from ${agentData.messages.length} stored messages`);
    }

    console.log(`[loom] ${hasLiveAgent ? 'Recreated' : 'Created'} agent "${agentId}" (config changed: ${hasLiveAgent})`);
    return agent;
}

export function buildSystemPrompt(agentId, basePrompt) {
    const agentData = state.agents.get(agentId);
    const ringContext = (agentData?.config?.ringInjection !== false)
        ? getRingContext(agentId)
        : '';

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
${ringContext}`;
}

export function getRingContext(agentId) {
    if (state.ringBuffer.length === 0) return '';

    // Find agents that share the active pipeline with this agent
    const pipelinePeers = new Set();
    const pipeline = getActivePipeline();
    if (pipeline) {
        const myTasks = pipeline.tasks.filter(t => t.agentId === agentId);
        if (myTasks.length) {
            for (const task of pipeline.tasks) {
                if (task.agentId && task.agentId !== agentId) pipelinePeers.add(task.agentId);
            }
        }
    }

    // Score and filter ring entries: exclude self, prefer pipeline peers
    const scored = state.ringBuffer
        .filter(e => e.agentId !== agentId)
        .map((e, i) => ({
            ...e,
            score: (pipelinePeers.has(e.agentId) ? 10 : 0) + i // recency + peer bonus
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    if (scored.length === 0) return '';
    return '\n## Recent Messages from Other Agents:\n' +
        scored.map(e => `[${e.agentId}]: ${e.content.slice(0, 200)}...`).join('\n');
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
                        <span class="agent-export" onclick="exportAgentDialog('${id}', event)" title="Export conversation">↓</span>
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
        const agent = new Agent({
            model, tools: allTools,
            systemPrompt: buildSystemPrompt('assistant', 'You are AGI, a helpful AI assistant. You can spawn sub-agents, schedule tasks, create custom tools, and coordinate with other agents.'),
            printer: false,
            conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, preserveRecentMessages: 10 }),
            hooks: [new InterruptHook(), new RetryHook()]
        });
        const color = state.agentColors[state.colorIndex % state.agentColors.length];
        state.colorIndex++;
        const config = { provider, systemPrompt: 'You are AGI, a helpful AI assistant. You can spawn sub-agents, schedule tasks, create custom tools, and coordinate with other agents.', maxTokens: DEFAULT_MAX_TOKENS, additionalRequestFields: provider === 'bedrock' ? DEFAULT_BEDROCK_ADDITIONAL_FIELDS : null };
        state.agents.set('assistant', { agent, model, config, _configHash: computeConfigHash(config), messages: [], status: 'ready', color });
        state.activeAgentId = 'assistant';
        updateAgentUI(); renderMessages(); saveState();
        showToast('Default agent ready');
    } catch (e) { console.warn('Could not auto-create default agent:', e); }
}
