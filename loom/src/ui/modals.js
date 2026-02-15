// ═══════════════════════════════════════════════════════════════════════════
// MODALS — spawn, edit, settings, schedule modals (HTML + handlers)
// ═══════════════════════════════════════════════════════════════════════════

import { state, DEFAULT_MODELS, DEFAULT_MAX_TOKENS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS, TOOL_GROUPS } from '../state/store.js';
import { showToast } from './toast.js';
import { getModelFlags, updateModelDatalist, PROVIDER_CAPS } from '../models/providers.js';
import { TOOLS, TOOL_DESCRIPTIONS } from '../tools/registry.js';
import { agentMesh } from '../mesh/local.js';
import { saveState } from '../sync/persistence.js';

export function injectModals() {
    const container = document.getElementById('modalContainer');
    container.innerHTML = getSpawnModalHTML() + getSettingsModalHTML() + getEditAgentModalHTML() + getScheduleModalHTML();
}

export function initModalHandlers() {
    // Close modal helper
    window.closeModal = (id) => document.getElementById(id).classList.remove('active');
    window.showTab = function(e, tabName) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(`tab-${tabName}`).classList.add('active');
    };
    window.toggleScheduleFields = function() {
        const type = document.getElementById('scheduleType').value;
        document.getElementById('delayField').style.display = type === 'once' ? 'block' : 'none';
        document.getElementById('cronField').style.display = type === 'cron' ? 'block' : 'none';
    };
    window.toggleMobileSidebar = () => document.getElementById('mobileSidebar').classList.toggle('active');
    window.toggleToolItem = (el) => el.classList.toggle('enabled');

    // MCP server helpers
    window.addMcpServerEntry = (containerId, cfg = {}) => {
        const div = document.createElement('div');
        div.className = 'mcp-server-entry';
        div.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;display:grid;gap:4px;';
        div.innerHTML = `<input class="form-input mcp-url" placeholder="https://mcp-server.example.com/mcp" value="${cfg.url || ''}" style="font-size:12px;"><input class="form-input mcp-token" placeholder="Bearer token (optional)" value="${cfg.bearerToken || ''}" style="font-size:12px;"><div style="display:flex;gap:6px;align-items:center;"><input class="form-input mcp-filter" placeholder="Tool filter regexps (comma-sep)" value="${cfg.toolFilter && cfg.toolFilter !== 'all' ? cfg.toolFilter.join(', ') : ''}" style="font-size:12px;flex:1;"><label style="font-size:11px;white-space:nowrap;display:flex;align-items:center;gap:3px;"><input type="checkbox" class="mcp-agentcore" ${cfg.isAgentCore ? 'checked' : ''}> AgentCore</label><button class="btn" type="button" onclick="this.closest('.mcp-server-entry').remove()" style="font-size:11px;padding:1px 6px;">✕</button></div>`;
        document.getElementById(containerId).appendChild(div);
    };

    window.importMcpFromJson = (containerId) => {
        const json = prompt('Paste kiro-cli agent JSON (or just the mcpServers block):');
        if (!json) return;
        try {
            const parsed = JSON.parse(json);
            const servers = parsed.mcpServers || parsed;
            let count = 0;
            for (const [, srv] of Object.entries(servers)) {
                if (srv.disabled || (!srv.url && srv.type !== 'http')) continue;
                const url = srv.url || ''; if (!url) continue;
                const bearer = srv.headers?.Authorization?.replace(/^Bearer\s+/i, '') || '';
                window.addMcpServerEntry(containerId, { url, bearerToken: bearer, toolFilter: 'all', isAgentCore: url.includes('gateway.bedrock-agentcore') });
                count++;
            }
            showToast(count ? `Imported ${count} HTTP MCP server(s)` : 'No HTTP MCP servers found');
        } catch (e) { showToast(`Import failed: ${e.message}`); }
    };

    // Spawn modal
    window.openSpawnModal = () => {
        document.getElementById('spawnId').value = '';
        document.getElementById('spawnProvider').value = 'bedrock';
        document.getElementById('spawnModelId').value = '';
        document.getElementById('spawnPrompt').value = '';
        document.getElementById('spawnMaxTokens').value = String(DEFAULT_MAX_TOKENS);
        document.getElementById('spawnAdditionalFields').value = JSON.stringify(DEFAULT_BEDROCK_ADDITIONAL_FIELDS, null, 2);
        document.getElementById('spawnMcpServers').innerHTML = '';
        window.updateSpawnModelDefaults();
        renderSpawnToolsList();
        document.getElementById('spawnModal').classList.add('active');
    };

    window.updateSpawnModelDefaults = function() {
        const provider = document.getElementById('spawnProvider').value;
        document.getElementById('spawnModelHint').textContent = `Default: ${DEFAULT_MODELS[provider] || 'unknown'}`;
        updateModelDatalist(provider, 'spawnModelList');
        const group = document.getElementById('spawnAdditionalFieldsGroup');
        const input = document.getElementById('spawnAdditionalFields');
        if (PROVIDER_CAPS[provider]?.additionalFields) { group.style.display = 'block'; if (provider === 'bedrock' && !input.value.trim()) input.value = JSON.stringify(DEFAULT_BEDROCK_ADDITIONAL_FIELDS, null, 2); }
        else { group.style.display = 'none'; }
    };

    window.onModelSelected = function(prefix) {
        const provider = document.getElementById(prefix + 'Provider').value;
        const modelId = document.getElementById(prefix + 'ModelId').value;
        const flags = getModelFlags(provider, modelId);
        if (flags) document.getElementById(prefix + 'AdditionalFields').value = JSON.stringify(flags, null, 2);
    };

    window.selectToolGroup = function(group) {
        const boxes = document.querySelectorAll('#spawnToolsList input[name="spawn-tool"]');
        if (group === 'all') { boxes.forEach(b => { b.checked = true; b.closest('.tool-item').classList.add('enabled'); }); return; }
        if (group === 'none') { boxes.forEach(b => { b.checked = false; b.closest('.tool-item').classList.remove('enabled'); }); return; }
        const names = TOOL_GROUPS[group] || [];
        boxes.forEach(b => { b.checked = false; b.closest('.tool-item').classList.remove('enabled'); });
        boxes.forEach(b => { if (names.includes(b.value)) { b.checked = true; b.closest('.tool-item').classList.add('enabled'); } });
    };

    // Settings modal
    window.openSettingsModal = () => {
        document.getElementById('anthropicKey').value = state.credentials.anthropic.apiKey;
        document.getElementById('openaiKey').value = state.credentials.openai.apiKey;
        document.getElementById('bedrockKey').value = state.credentials.bedrock.apiKey;
        document.getElementById('bedrockRegion').value = state.credentials.bedrock.region;
        document.getElementById('githubToken').value = state.credentials.github?.token || '';
        document.getElementById('compatBaseUrl').value = state.credentials.openai_compatible?.baseUrl || '';
        document.getElementById('compatKey').value = state.credentials.openai_compatible?.apiKey || '';
        document.getElementById('compatModel').value = state.credentials.openai_compatible?.model || '';
        document.getElementById('webllmModel').value = state.credentials.webllm?.model || 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
        document.getElementById('relayUrl').value = localStorage.getItem('mesh_relay_url') || '';
        document.getElementById('instanceId').value = window.AgentMesh?.relayInstanceId || '';
        agentMesh.updateWsStatus(agentMesh.wsConnected);
        agentMesh.updateRemotePeersUI();
        document.getElementById('settingsModal').classList.add('active');
    };

    window.saveCredentials = function() {
        state.credentials.anthropic.apiKey = document.getElementById('anthropicKey').value.trim();
        state.credentials.openai.apiKey = document.getElementById('openaiKey').value.trim();
        state.credentials.bedrock.apiKey = document.getElementById('bedrockKey').value.trim();
        state.credentials.bedrock.region = document.getElementById('bedrockRegion').value;
        state.credentials.github = state.credentials.github || {};
        state.credentials.github.token = document.getElementById('githubToken').value.trim();
        state.credentials.openai_compatible = state.credentials.openai_compatible || {};
        state.credentials.openai_compatible.baseUrl = document.getElementById('compatBaseUrl').value.trim();
        state.credentials.openai_compatible.apiKey = document.getElementById('compatKey').value.trim();
        state.credentials.openai_compatible.model = document.getElementById('compatModel').value.trim();
        state.credentials.webllm = state.credentials.webllm || {};
        state.credentials.webllm.model = document.getElementById('webllmModel').value;
        saveState();
        showToast('Credentials saved');
        window.closeModal('settingsModal');
    };

    // Network relay
    window.connectRelay = function() {
        const url = document.getElementById('relayUrl').value.trim();
        if (!url) { showToast('Enter relay URL'); return; }
        agentMesh.connectRelay(url);
    };
    window.disconnectRelay = function() { agentMesh.disconnectRelay(); localStorage.removeItem('mesh_relay_url'); };

    // Edit agent modal
    window.updateEditModelDefaults = function() {
        const provider = document.getElementById('editProvider').value;
        document.getElementById('editModelHint').textContent = `Default: ${DEFAULT_MODELS[provider] || 'unknown'}`;
        updateModelDatalist(provider, 'editModelList');
        document.getElementById('editAdditionalFieldsGroup').style.display = PROVIDER_CAPS[provider]?.additionalFields ? 'block' : 'none';
    };
}

function renderSpawnToolsList() {
    const container = document.getElementById('spawnToolsList');
    container.innerHTML = TOOL_DESCRIPTIONS.map(t => `<label class="tool-item enabled" onclick="toggleToolItem(this)"><input type="checkbox" name="spawn-tool" value="${t.name}" checked><div><div class="tool-item-name">${t.name}</div><div class="tool-item-desc">${t.desc}</div></div></label>`).join('');
}

function getMcpServersConfig(containerId) {
    return [...document.getElementById(containerId).querySelectorAll('.mcp-server-entry')].map(el => {
        const url = el.querySelector('.mcp-url').value.trim();
        if (!url) return null;
        const filterVal = el.querySelector('.mcp-filter').value.trim();
        return { url, bearerToken: el.querySelector('.mcp-token').value.trim() || undefined, toolFilter: filterVal ? filterVal.split(',').map(s => s.trim()).filter(Boolean) : 'all', isAgentCore: el.querySelector('.mcp-agentcore').checked };
    }).filter(Boolean);
}

// Export for use by lifecycle
export { getMcpServersConfig };

// ─── Modal HTML generators ───

function getSpawnModalHTML() {
    return `<div class="modal" id="spawnModal"><div class="modal-content" style="max-width:600px;"><div class="modal-header"><span class="modal-title">Spawn New Agent</span><button class="modal-close" onclick="closeModal('spawnModal')">×</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Agent ID</label><input type="text" class="form-input" id="spawnId" placeholder="e.g., researcher, coder"></div><div class="form-group"><label class="form-label">Model Provider</label><select class="form-input" id="spawnProvider" onchange="updateSpawnModelDefaults()"><option value="bedrock">Amazon Bedrock</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI (GPT)</option><option value="openai_compatible">OpenAI-Compatible</option><option value="webllm">WebLLM (Local)</option></select></div><div class="form-group"><label class="form-label">Model ID (optional)</label><input type="text" class="form-input" id="spawnModelId" list="spawnModelList" placeholder="Leave empty for default" oninput="onModelSelected('spawn')"><div class="form-hint" id="spawnModelHint"></div></div><div class="form-group"><label class="form-label">System Prompt</label><textarea class="form-input" id="spawnPrompt" rows="4" placeholder="You are a helpful assistant..."></textarea></div><div class="form-group"><label class="form-label">Max Tokens</label><input type="number" class="form-input" id="spawnMaxTokens" value="60000"></div><div class="form-group" id="spawnAdditionalFieldsGroup"><label class="form-label">Additional Request Fields (JSON)</label><textarea class="form-input" id="spawnAdditionalFields" rows="3"></textarea><div class="form-hint">Extended thinking, betas, etc.</div></div><div class="form-group"><label class="form-label">MCP Servers</label><div id="spawnMcpServers"></div><div style="display:flex;gap:4px;margin-top:4px;"><button class="btn" type="button" onclick="addMcpServerEntry('spawnMcpServers')" style="font-size:11px;padding:2px 8px;">+ Add MCP</button><button class="btn" type="button" onclick="importMcpFromJson('spawnMcpServers')" style="font-size:11px;padding:2px 8px;">📋 Import</button></div></div><div class="form-group"><label class="form-label">Tools</label><div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;"><button class="btn" onclick="selectToolGroup('all')" style="font-size:11px;padding:2px 8px;">All</button><button class="btn" onclick="selectToolGroup('core')" style="font-size:11px;padding:2px 8px;">Core</button><button class="btn" onclick="selectToolGroup('sandbox')" style="font-size:11px;padding:2px 8px;">Sandbox</button><button class="btn" onclick="selectToolGroup('pipeline')" style="font-size:11px;padding:2px 8px;">Pipeline</button><button class="btn" onclick="selectToolGroup('agents')" style="font-size:11px;padding:2px 8px;">Agents</button><button class="btn" onclick="selectToolGroup('github')" style="font-size:11px;padding:2px 8px;">GitHub</button><button class="btn" onclick="selectToolGroup('none')" style="font-size:11px;padding:2px 8px;">None</button></div><div id="spawnToolsList" class="tools-grid"></div></div><div class="btn-group"><button class="btn" onclick="closeModal('spawnModal')">Cancel</button><button class="btn btn-primary" onclick="spawnAgent()">Spawn Agent</button></div></div></div></div>`;
}

function getSettingsModalHTML() {
    return `<div class="modal" id="settingsModal"><div class="modal-content"><div class="modal-header"><span class="modal-title">Settings</span><button class="modal-close" onclick="closeModal('settingsModal')">×</button></div><div class="modal-body"><div class="tabs"><button class="tab active" onclick="showTab(event,'credentials')">API Keys</button><button class="tab" onclick="showTab(event,'network')">Network</button><button class="tab" onclick="showTab(event,'tools')">Tools</button><button class="tab" onclick="showTab(event,'sync')">Sync</button><button class="tab" onclick="showTab(event,'export')">Export</button></div><div class="tab-content active" id="tab-credentials"><div class="form-group"><label class="form-label">Anthropic API Key</label><input type="password" class="form-input" id="anthropicKey" placeholder="sk-ant-..."></div><div class="form-group"><label class="form-label">OpenAI API Key</label><input type="password" class="form-input" id="openaiKey" placeholder="sk-..."></div><div class="form-group"><label class="form-label">Bedrock API Key</label><input type="password" class="form-input" id="bedrockKey" placeholder="bedrock-api-key"><div class="form-hint">Generate at AWS Bedrock Console → API Keys</div></div><div class="form-group"><label class="form-label">Bedrock Region</label><select class="form-input" id="bedrockRegion"><option value="us-east-1">us-east-1</option><option value="us-west-2">us-west-2</option><option value="eu-west-1">eu-west-1</option><option value="ap-southeast-2">ap-southeast-2</option></select></div><div class="form-group"><label class="form-label">GitHub Token</label><input type="password" class="form-input" id="githubToken" placeholder="ghp_..."><button class="btn" onclick="githubDeviceFlow()" style="margin-top:4px;font-size:11px;">🔑 Device Flow</button></div><hr style="border-color:rgba(255,255,255,0.1);margin:16px 0"><div class="form-group"><label class="form-label">OpenAI-Compatible Endpoint</label><input type="text" class="form-input" id="compatBaseUrl" placeholder="http://localhost:11434/v1"><input type="password" class="form-input" id="compatKey" placeholder="API key (optional)" style="margin-top:4px"><input type="text" class="form-input" id="compatModel" placeholder="Model name" style="margin-top:4px"></div><hr style="border-color:rgba(255,255,255,0.1);margin:16px 0"><div class="form-group"><label class="form-label">🧠 WebLLM (Local)</label><select class="form-input" id="webllmModel"><option value="Qwen2.5-3B-Instruct-q4f16_1-MLC">Qwen 2.5 3B</option><option value="Qwen2.5-1.5B-Instruct-q4f16_1-MLC">Qwen 2.5 1.5B</option><option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">Llama 3.2 3B</option></select><div id="webllmProgress" style="display:none;font-size:12px;color:var(--text-secondary);margin-top:8px;"></div></div><button class="btn btn-primary" onclick="saveCredentials()">Save Credentials</button></div><div class="tab-content" id="tab-network"><div class="form-group"><label class="form-label">Relay Server URL</label><input type="text" class="form-input" id="relayUrl" placeholder="wss://your-relay.example.com"></div><div class="form-group"><label class="form-label">Instance ID</label><input type="text" class="form-input" id="instanceId" placeholder="Auto-generated"></div><div class="form-group"><label class="form-label">Status</label><div id="networkStatus" style="font-family:monospace;font-size:12px;padding:12px;background:rgba(0,0,0,0.3);border-radius:8px;"><div>Local: <span style="color:#0f0">● BroadcastChannel active</span></div><div>Remote: <span id="wsStatus" style="color:#f66">● Disconnected</span></div></div></div><div class="form-group"><label class="form-label">Remote Peers</label><div id="remotePeersList" style="font-size:12px;color:var(--text-tertiary);padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;">No remote peers</div></div><div class="btn-group"><button class="btn btn-primary" onclick="connectRelay()">Connect</button><button class="btn" onclick="disconnectRelay()">Disconnect</button></div></div><div class="tab-content" id="tab-tools"><div class="form-group"><label class="form-label">Custom Tools</label><div id="customToolsList" style="font-size:12px;color:var(--text-tertiary);">Agents can create tools with <code>create_tool</code>.</div></div></div><div class="tab-content" id="tab-sync"><div class="form-group"><label class="form-label">📤 Export Settings</label><div style="display:flex;gap:8px;margin-bottom:12px;"><input type="password" class="form-input" id="syncExportPassword" placeholder="Encryption password" style="flex:1;"><button class="btn btn-primary" onclick="exportSyncUrl()">Export</button></div><div id="syncExportResult" style="display:none;"><textarea class="form-input" id="syncExportedUrl" rows="3" readonly style="font-size:11px;"></textarea><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('syncExportedUrl').value);showToast('Copied!');" style="margin-top:8px;">📋 Copy</button></div></div><div class="form-group" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--divider);"><label class="form-label">📥 Import Settings</label><textarea class="form-input" id="syncImportUrl" rows="2" placeholder="Paste encrypted URL..." style="font-size:11px;margin-bottom:8px;"></textarea><div style="display:flex;gap:8px;"><input type="password" class="form-input" id="syncImportPassword" placeholder="Password" style="flex:1;"><button class="btn btn-primary" onclick="importSyncUrl()">Import</button></div></div></div><div class="tab-content" id="tab-export"><div class="form-group"><button class="btn" onclick="exportAllAgents()">📦 Export State</button></div><div class="form-group"><input type="file" id="importFile" accept=".json" style="display:none" onchange="importAgents(event)"><button class="btn" onclick="document.getElementById('importFile').click()">📥 Import State</button></div><div class="form-group"><button class="btn" style="color:rgba(255,100,100,0.8)" onclick="clearAllData()">🗑️ Clear Everything</button></div></div></div></div></div>`;
}

function getEditAgentModalHTML() {
    return `<div class="modal" id="editAgentModal"><div class="modal-content" style="max-width:600px;"><div class="modal-header"><span class="modal-title">Edit Agent: <span id="editAgentTitle"></span></span><button class="modal-close" onclick="closeModal('editAgentModal')">×</button></div><div class="modal-body"><input type="hidden" id="editAgentId"><div class="form-group"><label class="form-label">Model Provider</label><select class="form-input" id="editProvider" onchange="updateEditModelDefaults()"><option value="bedrock">Amazon Bedrock</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI (GPT)</option><option value="openai_compatible">OpenAI-Compatible</option><option value="webllm">WebLLM (Local)</option></select></div><div class="form-group"><label class="form-label">Model ID</label><input type="text" class="form-input" id="editModelId" list="editModelList" placeholder="Leave empty for default" oninput="onModelSelected('edit')"><div class="form-hint" id="editModelHint"></div></div><div class="form-group"><label class="form-label">System Prompt</label><textarea class="form-input" id="editPrompt" rows="4"></textarea></div><div class="form-group"><label class="form-label">Max Tokens</label><input type="number" class="form-input" id="editMaxTokens" value="60000"></div><div class="form-group" id="editAdditionalFieldsGroup"><label class="form-label">Additional Request Fields (JSON)</label><textarea class="form-input" id="editAdditionalFields" rows="3"></textarea></div><div class="form-group"><label class="form-label">MCP Servers</label><div id="editMcpServers"></div><div style="display:flex;gap:4px;margin-top:4px;"><button class="btn" type="button" onclick="addMcpServerEntry('editMcpServers')" style="font-size:11px;padding:2px 8px;">+ Add MCP</button><button class="btn" type="button" onclick="importMcpFromJson('editMcpServers')" style="font-size:11px;padding:2px 8px;">📋 Import</button></div></div><div class="form-group"><label class="form-label">Tools</label><div id="editToolsList" class="tools-grid"></div></div><div class="btn-group"><button class="btn" onclick="closeModal('editAgentModal')">Cancel</button><button class="btn btn-primary" onclick="saveAgentEdit()">Save Changes</button></div></div></div></div>`;
}

function getScheduleModalHTML() {
    return `<div class="modal" id="scheduleModal"><div class="modal-content"><div class="modal-header"><span class="modal-title">Schedule Task</span><button class="modal-close" onclick="closeModal('scheduleModal')">×</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Task Name</label><input type="text" class="form-input" id="scheduleName" placeholder="daily-summary"></div><div class="form-group"><label class="form-label">Agent</label><select class="form-input" id="scheduleAgent"></select></div><div class="form-group"><label class="form-label">Prompt</label><textarea class="form-input" id="schedulePrompt" rows="3"></textarea></div><div class="form-group"><label class="form-label">Schedule Type</label><select class="form-input" id="scheduleType" onchange="toggleScheduleFields()"><option value="once">Once (delayed)</option><option value="cron">Recurring (cron)</option></select></div><div class="form-group" id="delayField"><label class="form-label">Delay (seconds)</label><input type="number" class="form-input" id="scheduleDelay" value="60"></div><div class="form-group" id="cronField" style="display:none;"><label class="form-label">Cron Expression</label><input type="text" class="form-input" id="scheduleCron" placeholder="*/5 * * * *"></div><div class="btn-group"><button class="btn" onclick="closeModal('scheduleModal')">Cancel</button><button class="btn btn-primary" onclick="createSchedule()">Schedule</button></div></div></div></div>`;
}
