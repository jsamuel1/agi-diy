// AgentMesh Settings — shared modal with plugin-registered tabs
// Load AFTER agent-mesh.js. Plugins call AgentMesh.settings.registerTab() to add tabs.
(function() {
    'use strict';
    const M = window.AgentMesh;
    if (!M) return;

    const tabs = [];
    let activeTab = null;

    function registerTab(id, label, renderFn) {
        if (!tabs.find(t => t.id === id)) tabs.push({ id, label, render: renderFn });
    }

    function injectCSS() {
        if (document.getElementById('mesh-settings-css')) return;
        const s = document.createElement('style');
        s.id = 'mesh-settings-css';
        s.textContent = `
.ms-overlay { position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:center;justify-content:center; }
.ms-modal { background:var(--bg-panel,#12121a);border:1px solid var(--border,#2a2a3a);border-radius:12px;width:520px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;position:relative; }
.ms-tabs { display:flex;border-bottom:1px solid var(--border,#2a2a3a);padding:0 12px;overflow-x:auto; }
.ms-tab { padding:10px 16px;font-size:11px;color:var(--text-muted,#555);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap; }
.ms-tab.active { color:var(--accent,#7c5cff);border-bottom-color:var(--accent,#7c5cff); }
.ms-body { flex:1;overflow-y:auto;padding:16px;font-size:12px;color:var(--text,#e0e0e8); }
.ms-body label { display:flex;flex-direction:column;gap:4px;padding:4px 0; }
.ms-body input[type="text"] { background:var(--bg-card,#1a1a26);border:1px solid var(--border,#2a2a3a);color:var(--text,#e0e0e8);padding:5px 8px;border-radius:4px;font-size:11px;width:100%; }
.ms-body input[type="checkbox"] { width:16px;height:16px; }
.ms-body .ms-row { display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#2a2a3a); }
.ms-body .ms-hint { font-size:10px;color:var(--text-muted,#555);margin-top:4px; }
.ms-body .ms-addr { font-family:monospace;font-size:10px;color:var(--text-dim,#888);flex:1;overflow:hidden;text-overflow:ellipsis; }
.ms-btn { background:var(--bg-hover,#22222e);border:1px solid var(--border,#2a2a3a);color:var(--text-dim,#888);font-size:10px;padding:4px 10px;border-radius:4px;cursor:pointer; }
.ms-btn:hover { color:var(--text,#e0e0e8);border-color:var(--accent,#7c5cff); }
.ms-btn.primary { background:var(--accent,#7c5cff);color:#000;border-color:var(--accent,#7c5cff); }
.ms-btn.success { background:var(--green,#00ff88);color:#000;border-color:var(--green,#00ff88); }
.ms-btn.danger { color:var(--red,#ff6666); }
.ms-btn.danger:hover { border-color:var(--red,#ff6666); }
.ms-close { position:absolute;top:8px;right:12px;background:none;border:none;color:var(--text-muted,#555);font-size:16px;cursor:pointer; }
`;
        document.head.appendChild(s);
    }

    function open(tabId) {
        injectCSS();
        activeTab = tabId || tabs[0]?.id;
        let root = document.getElementById('meshSettingsRoot');
        if (!root) { root = document.createElement('div'); root.id = 'meshSettingsRoot'; document.body.appendChild(root); }
        render(root);
    }

    function close() {
        const root = document.getElementById('meshSettingsRoot');
        if (root) root.innerHTML = '';
    }

    function render(root) {
        const tab = tabs.find(t => t.id === activeTab) || tabs[0];
        if (!tab) { root.innerHTML = ''; return; }
        root.innerHTML = `<div class="ms-overlay" onclick="if(event.target===this)AgentMesh.settings.close()">
            <div class="ms-modal">
                <button class="ms-close" onclick="AgentMesh.settings.close()">✕</button>
                <div class="ms-tabs">${tabs.map(t =>
                    `<div class="ms-tab ${t.id===activeTab?'active':''}" onclick="AgentMesh.settings.open('${t.id}')">${t.label}</div>`
                ).join('')}</div>
                <div class="ms-body" id="msTabBody"></div>
            </div>
        </div>`;
        const body = document.getElementById('msTabBody');
        if (body && tab.render) tab.render(body);
    }

    M.settings = { registerTab, open, close };
})();
