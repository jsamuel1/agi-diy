// ═══════════════════════════════════════════════════════════════════════════
// SANDBOX TOOLS — sandbox_create, sandbox_update, preview mode
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { scrollToBottom } from '../ui/toast.js';

let latestSandboxId = null;

function getSandboxes() { try { return JSON.parse(localStorage.getItem('agi_sandboxes') || '{}'); } catch { return {}; } }
function saveSandboxes(s) { localStorage.setItem('agi_sandboxes', JSON.stringify(s)); }

function renderSandboxIframe(sandbox) {
    const wrap = document.createElement('div');
    wrap.className = 'sandbox-wrap';
    wrap.innerHTML = `<div class="sandbox-header"><span>🔒 ${sandbox.name || sandbox.id}</span><button onclick="this.closest('.sandbox-wrap').querySelector('iframe').style.height=this.closest('.sandbox-wrap').querySelector('iframe').style.height==='80vh'?'500px':'80vh'">↕</button></div>`;
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.style.cssText = 'width:100%;height:500px;border:none;border-radius:0 0 8px 8px;background:#fff;';
    iframe.srcdoc = `<!DOCTYPE html><html><head><style>${sandbox.css||''}</style></head><body>${sandbox.html||''}<script>${sandbox.js||''}<\/script></body></html>`;
    wrap.appendChild(iframe);
    return wrap;
}

export function initPreviewMode() {
    window.togglePreviewMode = function() {
        const bg = document.getElementById('previewBackground');
        const isActive = document.body.classList.toggle('preview-mode');
        document.getElementById('previewToggle').style.color = isActive ? '#00ff88' : '';
        if (isActive && latestSandboxId) {
            const sb = getSandboxes()[latestSandboxId];
            if (sb) { bg.innerHTML = ''; const f = document.createElement('iframe'); f.sandbox = 'allow-scripts'; f.style.cssText = 'width:100%;height:100%;border:none;'; f.srcdoc = `<!DOCTYPE html><html><head><style>${sb.css||''}</style></head><body>${sb.html||''}<script>${sb.js||''}<\/script></body></html>`; bg.appendChild(f); }
        } else { bg.innerHTML = ''; }
    };
}

export const sandboxCreateTool = tool({
    name: 'sandbox_create',
    description: 'Create a sandboxed HTML/CSS/JS app in an isolated iframe.',
    inputSchema: z.object({ name: z.string(), html: z.string().optional(), css: z.string().optional(), js: z.string().optional() }),
    callback: async (input) => {
        const id = 'sb-' + Date.now().toString(36);
        const sandbox = { id, name: input.name, html: input.html || '', css: input.css || '', js: input.js || '', createdBy: state.activeAgentId, lastModified: Date.now() };
        const all = getSandboxes(); all[id] = sandbox; saveSandboxes(all);
        const container = document.getElementById('messagesInner');
        if (container) container.appendChild(renderSandboxIframe(sandbox));
        scrollToBottom();
        latestSandboxId = id;
        return { created: id, name: input.name };
    }
});

export const sandboxUpdateTool = tool({
    name: 'sandbox_update',
    description: 'Update an existing sandbox.',
    inputSchema: z.object({ id: z.string(), html: z.string().optional(), css: z.string().optional(), js: z.string().optional(), name: z.string().optional() }),
    callback: async (input) => {
        const all = getSandboxes(); const sb = all[input.id];
        if (!sb) return { error: 'Sandbox not found' };
        if (input.html !== undefined) sb.html = input.html;
        if (input.css !== undefined) sb.css = input.css;
        if (input.js !== undefined) sb.js = input.js;
        if (input.name !== undefined) sb.name = input.name;
        sb.lastModified = Date.now(); saveSandboxes(all);
        const container = document.getElementById('messagesInner');
        if (container) container.appendChild(renderSandboxIframe(sb));
        scrollToBottom();
        latestSandboxId = input.id;
        return { updated: input.id };
    }
});

export const sandboxReadTool = tool({
    name: 'sandbox_read', description: "Read a sandbox's current code.",
    inputSchema: z.object({ id: z.string() }),
    callback: async (input) => { const sb = getSandboxes()[input.id]; return sb || { error: 'Sandbox not found' }; }
});

export const sandboxListTool = tool({
    name: 'sandbox_list', description: 'List all saved sandboxes.',
    inputSchema: z.object({}),
    callback: async () => Object.values(getSandboxes()).map(s => ({ id: s.id, name: s.name, lastModified: s.lastModified }))
});

export const sandboxDeleteTool = tool({
    name: 'sandbox_delete', description: 'Delete a sandbox by ID.',
    inputSchema: z.object({ id: z.string() }),
    callback: async (input) => { const all = getSandboxes(); if (!all[input.id]) return { error: 'Not found' }; delete all[input.id]; saveSandboxes(all); return { deleted: input.id }; }
});
