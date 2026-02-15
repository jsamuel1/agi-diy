// ═══════════════════════════════════════════════════════════════════════════
// APP — Entry point. Imports all modules, wires callbacks, runs init.
// ═══════════════════════════════════════════════════════════════════════════

import { state, DEFAULT_MAX_TOKENS, DEFAULT_MODELS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS } from './state/store.js';
import { Agent } from './vendor/strands.js';
import { createModel, PROVIDER_CAPS, providerReady, detectProvider } from './models/providers.js';
import { showToast } from './ui/toast.js';
import { renderMessages, updateRingUI } from './ui/messages.js';
import { addMessageToUI } from './ui/messages.js';
import { updatePipelineUI } from './ui/pipeline.js';
import { filterActivityFeed } from './ui/activity.js';
import { injectModals, initModalHandlers, getMcpServersConfig } from './ui/modals.js';
import { initSyncHandlers, checkForImportParam } from './sync/encrypted.js';
import { saveState, loadState, exportAllAgents, importAgents, clearAllData } from './sync/persistence.js';
import { TOOLS, TOOL_DESCRIPTIONS } from './tools/registry.js';
import { buildCustomTools, loadCustomTools, saveCustomTools, setSelfModCallbacks } from './tools/self-mod.js';
import { setCoreCallbacks, schedulerTool } from './tools/core.js';
import { agentMesh, setMeshCallbacks, updateMeshLog } from './mesh/local.js';
import { initPreviewMode } from './tools/sandbox.js';
import { buildSystemPrompt, connectMcpServers, updateAgentUI, selectAgent, killAgent, autoCreateDefaultAgent } from './agent/lifecycle.js';
import { runAgentMessage, sendMessage, broadcastMessagePrompt, clearChat, clearAllChats, sendInterrupt, handleKeyDown } from './agent/messaging.js';
import { initVoice, toggleVoice, voiceCfgChanged, populateVoices } from './ui/voice.js';

// ─── Wire callback dependencies ───
setCoreCallbacks({
    runAgentMessage,
    updateAgentUI,
    updateScheduleUI,
    saveState,
    getTools: () => TOOLS
});

setSelfModCallbacks({ saveState });

setMeshCallbacks({
    updateAgentUI,
    updateMeshLog
});

// ─── Schedule UI ───
function updateScheduleUI() {
    const container = document.getElementById('scheduleList');
    if (state.schedules.size === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);">No tasks scheduled</div>';
        return;
    }
    let html = '';
    for (const [id, s] of state.schedules) {
        html += `<div class="schedule-item"><div class="schedule-item-header"><strong>${s.name}</strong><span class="schedule-delete" onclick="deleteSchedule('${id}')">✕</span></div><div>Agent: ${s.agentId}</div><div class="schedule-cron">${s.type === 'cron' ? s.cron : `once in ${s.delay}s`}</div></div>`;
    }
    container.innerHTML = html;
}

// ─── Custom Tools UI ───
function updateCustomToolsUI() {
    const container = document.getElementById('customToolsList');
    if (!container) return;
    const customTools = loadCustomTools();
    const toolNames = Object.keys(customTools);
    if (toolNames.length === 0) {
        container.innerHTML = `<div style="color:var(--text-tertiary);">No custom tools yet. Agents can create tools with <code>create_tool</code>.</div>`;
    } else {
        container.innerHTML = `<div style="margin-bottom:8px;color:var(--text-secondary);">${toolNames.length} custom tool(s) saved:</div>` +
            toolNames.map(name => {
                const t = customTools[name];
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:4px;"><div><code style="color:var(--text)">${name}</code><span style="color:var(--text-tertiary);font-size:11px;margin-left:8px;">${t.description?.slice(0,40) || ''}...</span></div><button onclick="deleteCustomTool('${name}')" style="background:transparent;border:none;color:rgba(255,100,100,0.6);cursor:pointer;font-size:12px;" title="Delete tool">✕</button></div>`;
            }).join('') +
            `<div style="margin-top:12px;font-size:11px;color:var(--text-tertiary);">⚠️ Custom tools are available to newly spawned agents. Refresh page to apply to all.</div>`;
    }
}

// ─── Spawn Agent (reads from DOM) ───
window.spawnAgent = async function() {
    const id = document.getElementById('spawnId').value.trim();
    const provider = document.getElementById('spawnProvider').value;
    const modelId = document.getElementById('spawnModelId').value.trim();
    const systemPrompt = document.getElementById('spawnPrompt').value.trim() || 'You are a helpful AI assistant.';
    const maxTokens = parseInt(document.getElementById('spawnMaxTokens').value) || DEFAULT_MAX_TOKENS;
    const additionalFieldsStr = document.getElementById('spawnAdditionalFields').value.trim();

    if (!id) { showToast('Enter agent ID'); return; }
    if (state.agents.has(id)) { showToast('Agent ID exists'); return; }

    let additionalRequestFields = null;
    if (additionalFieldsStr) {
        try { additionalRequestFields = JSON.parse(additionalFieldsStr); }
        catch (e) { showToast('Invalid JSON in additional fields'); return; }
    }

    const toolCheckboxes = document.querySelectorAll('#spawnToolsList input[name="spawn-tool"]:checked');
    const enabledTools = Array.from(toolCheckboxes).map(cb => cb.value);
    const allToolsEnabled = enabledTools.length === TOOLS.length;

    try {
        const model = createModel(provider, { modelId: modelId || undefined, maxTokens, additionalRequestFields });
        const selectedTools = allToolsEnabled ? TOOLS : TOOLS.filter(t => enabledTools.includes(t.name));
        const customTools = buildCustomTools();
        const allTools = [...selectedTools, ...customTools];

        const mcpServers = getMcpServersConfig('spawnMcpServers');
        const { clients: mcpClients, toolNames: mcpToolNames, tools: mcpTools } = await connectMcpServers(mcpServers);
        allTools.push(...mcpTools);

        const agent = new Agent({ model, tools: allTools, systemPrompt: buildSystemPrompt(id, systemPrompt), printer: false });
        const color = state.agentColors[state.colorIndex % state.agentColors.length];
        state.colorIndex++;

        state.agents.set(id, {
            agent, model,
            config: { provider, modelId: modelId || undefined, systemPrompt, maxTokens, additionalRequestFields, enabledTools: allToolsEnabled ? null : enabledTools, mcpServers: mcpServers.length ? mcpServers : undefined },
            mcpClients, mcpToolNames, messages: [], status: 'ready', color
        });

        window.closeModal('spawnModal');
        updateAgentUI(); selectAgent(id);
        showToast(`Agent ${id} spawned`);
        saveState();
    } catch (e) { showToast('Error: ' + e.message); }
};

// ─── Edit Agent Modal ───
window.openEditAgentModal = function(agentId, event) {
    event.stopPropagation();
    const agentData = state.agents.get(agentId);
    if (!agentData) return;

    document.getElementById('editAgentId').value = agentId;
    document.getElementById('editAgentTitle').textContent = agentId;
    document.getElementById('editProvider').value = agentData.config.provider;
    document.getElementById('editModelId').value = agentData.config.modelId || '';
    document.getElementById('editPrompt').value = agentData.config.systemPrompt || '';
    document.getElementById('editMaxTokens').value = agentData.config.maxTokens || 16000;
    document.getElementById('editAdditionalFields').value = agentData.config.additionalRequestFields
        ? JSON.stringify(agentData.config.additionalRequestFields, null, 2) : '';
    const editMcpContainer = document.getElementById('editMcpServers');
    editMcpContainer.innerHTML = '';
    for (const srv of agentData.config.mcpServers || []) window.addMcpServerEntry('editMcpServers', srv);
    window.updateEditModelDefaults();
    const provider = agentData.config.provider;
    document.getElementById('editAdditionalFieldsGroup').style.display = PROVIDER_CAPS[provider]?.additionalFields ? 'block' : 'none';
    renderEditToolsList(agentData.config.enabledTools || null);
    document.getElementById('editAgentModal').classList.add('active');
};

function renderEditToolsList(enabledTools) {
    const container = document.getElementById('editToolsList');
    const isAllEnabled = enabledTools === null;
    container.innerHTML = TOOL_DESCRIPTIONS.map(t => {
        const enabled = isAllEnabled || (enabledTools && enabledTools.includes(t.name));
        return `<label class="tool-item ${enabled ? 'enabled' : ''}" onclick="toggleToolItem(this)"><input type="checkbox" name="tool" value="${t.name}" ${enabled ? 'checked' : ''}><div><div class="tool-item-name">${t.name}</div><div class="tool-item-desc">${t.desc}</div></div></label>`;
    }).join('');
}

window.saveAgentEdit = async function() {
    const agentId = document.getElementById('editAgentId').value;
    const agentData = state.agents.get(agentId);
    if (!agentData) return;

    const provider = document.getElementById('editProvider').value;
    const modelId = document.getElementById('editModelId').value.trim();
    const systemPrompt = document.getElementById('editPrompt').value.trim() || 'You are a helpful AI assistant.';
    const maxTokens = parseInt(document.getElementById('editMaxTokens').value) || DEFAULT_MAX_TOKENS;
    const additionalFieldsStr = document.getElementById('editAdditionalFields').value.trim();

    let additionalRequestFields = null;
    if (additionalFieldsStr) {
        try { additionalRequestFields = JSON.parse(additionalFieldsStr); }
        catch (e) { showToast('Invalid JSON in additional fields'); return; }
    }

    const toolCheckboxes = document.querySelectorAll('#editToolsList input[name="tool"]:checked');
    const enabledTools = Array.from(toolCheckboxes).map(cb => cb.value);
    const allToolsEnabled = enabledTools.length === TOOLS.length;

    try {
        const model = createModel(provider, { modelId: modelId || undefined, maxTokens, additionalRequestFields });
        const selectedTools = allToolsEnabled ? TOOLS : TOOLS.filter(t => enabledTools.includes(t.name));
        const customTools = buildCustomTools();
        const allTools = [...selectedTools, ...customTools];

        const mcpServers = getMcpServersConfig('editMcpServers');
        const oldServers = JSON.stringify(agentData.config.mcpServers || []);
        const newServers = JSON.stringify(mcpServers);
        let mcpClients = agentData.mcpClients || [];
        let mcpToolNames = agentData.mcpToolNames || [];

        if (newServers !== oldServers) {
            for (const c of mcpClients) c.disconnect().catch(() => {});
            const result = await connectMcpServers(mcpServers);
            mcpClients = result.clients; mcpToolNames = result.toolNames; allTools.push(...result.tools);
        } else if (mcpClients.length) {
            for (const c of mcpClients) {
                try { const t = await c.listTools(); mcpToolNames.push(...t.map(x => x.name)); allTools.push(...t); } catch (e) {}
            }
        }

        const agent = new Agent({ model, tools: allTools, systemPrompt: buildSystemPrompt(agentId, systemPrompt), printer: false });
        agentData.agent = agent; agentData.model = model;
        agentData.mcpClients = mcpClients; agentData.mcpToolNames = mcpToolNames;
        agentData.config = { provider, modelId: modelId || undefined, systemPrompt, maxTokens, additionalRequestFields, enabledTools: allToolsEnabled ? null : enabledTools, mcpServers: mcpServers.length ? mcpServers : undefined };

        window.closeModal('editAgentModal');
        updateAgentUI(); saveState();
        showToast(`Agent ${agentId} updated`);

        if (agentId === state.activeAgentId) {
            document.getElementById('currentAgentName').textContent = agentId;
            document.getElementById('currentAgentModel').textContent = `${provider} • ${modelId || DEFAULT_MODELS[provider]}`;
        }
    } catch (e) { showToast('Error: ' + e.message); }
};

// ─── Schedule functions ───
window.createSchedule = async function() {
    const name = document.getElementById('scheduleName').value.trim();
    const agentId = document.getElementById('scheduleAgent').value;
    const prompt = document.getElementById('schedulePrompt').value.trim();
    const type = document.getElementById('scheduleType').value;
    const delay = parseInt(document.getElementById('scheduleDelay').value) || 60;
    const cron = document.getElementById('scheduleCron').value.trim();
    if (!name || !agentId || !prompt) { showToast('Fill in all required fields'); return; }
    const result = await schedulerTool.callback({ action: 'create', name, agentId, prompt, type, delay: type === 'once' ? delay : undefined, cron: type === 'cron' ? cron : undefined });
    if (result.success) { showToast(`Schedule "${name}" created`); window.closeModal('scheduleModal'); } else { showToast(result.error || 'Failed'); }
};

window.deleteSchedule = function(id) {
    const s = state.schedules.get(id);
    if (s) {
        if (s.timer) clearTimeout(s.timer);
        if (s.interval) clearInterval(s.interval);
        state.schedules.delete(id);
        updateScheduleUI(); saveState();
        showToast('Schedule deleted');
    }
};

window.openScheduleModal = function() {
    document.getElementById('scheduleModal').classList.add('active');
};

// ─── Custom tool deletion ───
window.deleteCustomTool = function(name) {
    if (!confirm(`Delete custom tool "${name}"?`)) return;
    const customTools = loadCustomTools();
    delete customTools[name];
    saveCustomTools(customTools);
    updateCustomToolsUI();
    showToast(`Tool "${name}" deleted`);
};

// ─── GitHub Device Flow ───
window.githubDeviceFlow = async function() {
    const clientId = prompt('Enter your GitHub OAuth App Client ID (create at github.com/settings/developers):');
    if (!clientId) return;
    try {
        const codeRes = await fetch('https://github.com/login/device/code', {
            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, scope: 'repo' })
        }).then(r => r.json());
        showToast(`Go to ${codeRes.verification_uri} and enter: ${codeRes.user_code}`);
        addMessageToUI('system', `🔑 GitHub Device Flow: Go to **${codeRes.verification_uri}** and enter code: **${codeRes.user_code}**`);
        const interval = (codeRes.interval || 5) * 1000;
        const poll = setInterval(async () => {
            try {
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: clientId, device_code: codeRes.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
                }).then(r => r.json());
                if (tokenRes.access_token) {
                    clearInterval(poll);
                    state.credentials.github = { token: tokenRes.access_token };
                    document.getElementById('githubToken').value = tokenRes.access_token;
                    saveState(); showToast('GitHub authenticated!');
                }
            } catch {}
        }, interval);
    } catch (e) { showToast('Device flow failed: ' + e.message); }
};

// ─── Ring buffer UI helpers ───
window.clearRingContext = function() {
    state.ringBuffer.length = 0;
    if (window.AgentMesh?.clearRingContext) window.AgentMesh.clearRingContext();
    updateRingUI();
    showToast('Ring context cleared');
};

window.deleteRingEntry = function(index) {
    state.ringBuffer.splice(index, 1);
    updateRingUI();
};

// ─── Expose globals for onclick handlers in HTML ───
window.selectAgent = selectAgent;
window.killAgent = killAgent;
window.sendMessage = sendMessage;
window.handleKeyDown = handleKeyDown;
window.clearChat = clearChat;
window.clearAllChats = clearAllChats;
window.broadcastMessage = broadcastMessagePrompt;
window.sendInterrupt = sendInterrupt;
window.exportAllAgents = exportAllAgents;
window.importAgents = importAgents;
window.clearAllData = clearAllData;
window.filterActivityFeed = filterActivityFeed;
window.toggleVoice = toggleVoice;
window.voiceCfgChanged = voiceCfgChanged;

// ─── INIT ───
(async () => {
    // Inject modal HTML
    injectModals();
    initModalHandlers();
    initSyncHandlers();
    initPreviewMode();

    // Panel resizer
    (() => {
        const r = document.getElementById('panelResizer'), panels = document.querySelector('.content-panels');
        if (!r || !panels) return;
        let dragging = false;
        r.addEventListener('mousedown', () => { dragging = true; r.classList.add('dragging'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; });
        document.addEventListener('mousemove', e => { if (!dragging) return; const rect = panels.getBoundingClientRect(); const pct = ((e.clientX - rect.left) / rect.width * 100); const chat = panels.querySelector('.chat-panel'), act = panels.querySelector('.activity-panel'); chat.style.flex = 'none'; chat.style.width = Math.max(20, Math.min(80, pct)) + '%'; act.style.flex = '1'; });
        document.addEventListener('mouseup', () => { if (dragging) { dragging = false; r.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = ''; } });
    })();

    // Init mesh
    agentMesh.init();

    // Load persisted state
    await loadState();
    updateAgentUI();
    updateRingUI();

    // Periodic pipeline refresh while agents are processing
    setInterval(() => {
        const anyProcessing = [...state.agents.values()].some(a => a.status === 'processing');
        if (anyProcessing) updatePipelineUI();
    }, 2000);
    updateScheduleUI();
    renderMessages();
    updatePipelineUI();

    // Check for ?q= query parameter (iPhone shortcut support)
    function checkForQueryParam() {
        const url = new URL(window.location.href);
        const query = url.searchParams.get('q');
        if (query) {
            window.history.replaceState({}, '', window.location.pathname);
            setTimeout(async () => {
                if (state.agents.size === 0) await autoCreateDefaultAgent();
                if (state.agents.size > 0) {
                    const targetAgent = state.activeAgentId || state.agents.keys().next().value;
                    if (targetAgent) runAgentMessage(targetAgent, query);
                } else { showToast('Add API key in Settings first'); }
            }, 1500);
        }
    }
    checkForQueryParam();
    checkForImportParam();

    // Update custom tools UI when tools tab is shown
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.textContent.trim() === 'Tools') updateCustomToolsUI();
        });
    });

    // Auto-create default agent after short delay
    setTimeout(autoCreateDefaultAgent, 100);

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

    // Set page title
    const pageName = location.pathname.split('/').pop().replace(/\.html?$/,'') || 'loom';
    document.getElementById('brandTitle').childNodes[0].textContent = pageName + ' ';
    document.title = pageName + ' — multi-agent';

    // Expose for AgentMesh cross-page communication
    window.state = state;
    window.runAgentMessage = runAgentMessage;

    // Listen for credential changes from other tabs
    window.addEventListener('agimesh:credentials', (e) => {
        const c = e.detail;
        if (c.anthropic?.apiKey) state.credentials.anthropic.apiKey = c.anthropic.apiKey;
        if (c.openai?.apiKey) state.credentials.openai.apiKey = c.openai.apiKey;
        if (c.bedrock?.apiKey) state.credentials.bedrock.apiKey = c.bedrock.apiKey;
        showToast('Credentials synced from another tab');
    });
    window.addEventListener('storage', (e) => { if (e.key === 'agi-mesh-ring-context') updateRingUI(); });

    // Delayed AgentMesh init (agent-mesh.js loads after this module)
    setTimeout(() => {
        document.getElementById('agent-mesh-nav')?.style.setProperty('display','none','important');
        const nav = document.getElementById('agent-mesh-nav');
        if (nav) { const hr = document.querySelector('.header-right'); if (hr) { nav.style.cssText = 'display:flex!important;gap:2px;align-items:center;position:static;transform:none;background:none;border:none;padding:0;backdrop-filter:none;-webkit-backdrop-filter:none;'; hr.prepend(nav); } }
        if (!window.AgentMesh?.subscribe) return;
        window.AgentMesh.subscribe('ring-update', () => updateRingUI());
        window.AgentMesh.subscribe('ring-clear', () => updateRingUI());
        window.AgentMesh.subscribe('ping', () => updateAgentUI());
        for (const [id, data] of state.agents) {
            window.AgentMesh.registerAgent?.(id, 'strands', { model: data.config?.provider, status: data.status });
        }
        // 🔑 AgentMesh is the credential authority — always prefer its values
        const mc = window.AgentMesh.getCredentials?.();
        if (mc) {
            let u = false;
            if (mc.anthropic?.apiKey) { state.credentials.anthropic.apiKey = mc.anthropic.apiKey; u = true; }
            if (mc.openai?.apiKey) { state.credentials.openai.apiKey = mc.openai.apiKey; u = true; }
            if (mc.bedrock?.apiKey) { state.credentials.bedrock.apiKey = mc.bedrock.apiKey; u = true; }
            if (mc.bedrock?.region) { state.credentials.bedrock.region = mc.bedrock.region; u = true; }
            if (u) { saveState(); showToast('🔑 Loaded credentials from AgentMesh'); }
        }
    }, 600);

    // Init voice
    initVoice();

    console.log('%c🪡 loom Multi-Agent v1.0', 'font-size:16px;font-weight:bold;');
    console.log('%cSpawn agents, schedule tasks, let them coordinate via ring attention.', 'color:#888');
})();
