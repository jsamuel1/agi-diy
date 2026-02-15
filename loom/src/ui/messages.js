// ═══════════════════════════════════════════════════════════════════════════
// UI RENDERING — addMessageToUI, streaming, tool calls, ring buffer
// ═══════════════════════════════════════════════════════════════════════════

import { state } from '../state/store.js';
import { escapeHtml, scrollToBottom } from './toast.js';

export const streamingEls = new Map(); // agentId -> streaming element

export function renderMessages() {
    const inner = document.getElementById('messagesInner');
    inner.innerHTML = '';

    if (!state.activeAgentId) {
        inner.innerHTML = `<div class="message system"><div class="message-content">
            <strong>Getting Started</strong><br><br>
            ${Object.values(state.credentials).some(c => c.apiKey)
                ? 'Creating default agent... If this takes too long, try clicking "+ New Agent".'
                : 'Add your API key in ⚙️ Settings to start chatting, or click "+ New Agent" to configure a new agent.'}
        </div></div>`;
        document.getElementById('currentAgentName').textContent = 'No Agent Selected';
        document.getElementById('currentAgentModel').textContent = '—';
        return;
    }

    const agentData = state.agents.get(state.activeAgentId);
    if (!agentData) return;

    for (const msg of agentData.messages) {
        addMessageToUI(msg.role, msg.content, state.activeAgentId, agentData.color, false);
    }
    scrollToBottom();
}

export function addMessageToUI(role, content, agentId, color, scroll = true) {
    const inner = document.getElementById('messagesInner');
    const msg = document.createElement('div');
    msg.className = `message ${role}`;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userColor = '#3b82f6';
    const arr = '<span class="message-arrow">›</span>';
    const header = role === 'user'
        ? `<span class="message-agent" style="background:${userColor}20;color:${userColor}">you</span>${arr}<span class="message-agent" style="background:${color}20;color:${color}">${agentId}</span>`
        : `<span class="message-role">agi</span><span class="message-agent" style="background:${color}20;color:${color}">${agentId}</span>${arr}<span class="message-agent" style="background:${userColor}20;color:${userColor}">you</span>`;

    msg.innerHTML = `
        <div class="message-header">
            ${header}
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${role === 'user' ? escapeHtml(content) : `<div class="markdown-content">${marked.parse(content)}</div>`}</div>
    `;

    inner.appendChild(msg);
    if (scroll) scrollToBottom();
}

export function updateStreaming(text, agentId, color) {
    const inner = document.getElementById('messagesInner');
    removeThinking();

    let streamingEl = streamingEls.get(agentId);
    if (!streamingEl) {
        streamingEl = document.createElement('div');
        streamingEl.className = 'message assistant';
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        streamingEl.innerHTML = `
            <div class="message-header">
                <span class="message-role">agi</span>
                <span class="message-agent" style="background:${color}20;color:${color}">${agentId}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content"><div class="markdown-content"></div></div>
        `;
        inner.appendChild(streamingEl);
        streamingEls.set(agentId, streamingEl);
    }

    streamingEl.querySelector('.markdown-content').innerHTML = marked.parse(text);
    scrollToBottom();
}

export function finalizeStreaming(text, agentId, color) {
    const streamingEl = streamingEls.get(agentId);
    if (streamingEl) {
        streamingEl.querySelector('.markdown-content').innerHTML = marked.parse(text);
        streamingEls.delete(agentId);
    }
}

export function addToolCall(name, input, status, toolId) {
    const inner = document.getElementById('messagesInner');
    const toolEl = document.createElement('div');
    toolEl.className = 'tool-block';
    toolEl.id = toolId || `tool-${name}-${Date.now()}`;
    toolEl.innerHTML = `
        <div class="tool-header">
            <div class="tool-status ${status}"></div>
            <span class="tool-name">${name}</span>
        </div>
        <details><summary style="cursor:pointer;color:var(--text-tertiary);font-size:10px;margin-top:8px;">input</summary>
        <div class="tool-input">${JSON.stringify(input, null, 2)}</div></details>
    `;
    inner.appendChild(toolEl);
    scrollToBottom();
}

export function updateToolStatus(toolId, name, status, result) {
    const block = (toolId ? document.getElementById(toolId) : null)
        || [...document.querySelectorAll('.tool-block')].reverse().find(b => b.querySelector('.tool-name')?.textContent === name);
    if (!block) return;
    block.querySelector('.tool-status').className = `tool-status ${status === 'error' ? 'error' : ''}`;
    if (result) {
        const out = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        if (out && out.length > 2) {
            const d = document.createElement('details');
            d.innerHTML = `<summary style="cursor:pointer;color:var(--text-tertiary);font-size:10px;margin-top:4px;">output</summary><div class="tool-input">${escapeHtml(out.substring(0, 2000))}</div>`;
            block.appendChild(d);
        }
    }
}

export function addThinking() {
    const inner = document.getElementById('messagesInner');
    if (inner.querySelector('.thinking-indicator')) return;
    const el = document.createElement('div');
    el.className = 'message assistant thinking-indicator';
    el.innerHTML = '<div class="message-content"><div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div></div>';
    inner.appendChild(el);
    scrollToBottom();
}

export function removeThinking() {
    document.querySelector('.thinking-indicator')?.remove();
}

export function updateRingUI() {
    const container = document.getElementById('ringContent');
    if (!container) return;
    let allEntries = state.ringBuffer.map((e, idx) => ({ ...e, localIndex: idx }));
    // Merge AgentMesh ring entries from other tabs
    if (window.AgentMesh?.getRingContext) {
        for (const entry of window.AgentMesh.getRingContext()) {
            const isDup = allEntries.some(e => e.agentId === entry.agentId && Math.abs(e.timestamp - entry.timestamp) < 5000 && e.content?.slice(0, 50) === entry.text?.slice(0, 50));
            if (!isDup) allEntries.push({ agentId: entry.agentId, role: 'assistant', content: entry.text, timestamp: entry.timestamp, isMesh: true });
        }
    }
    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    const recent = allEntries.slice(-20).reverse();

    if (recent.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);text-align:center;padding:20px;">Shared context will appear here</div>';
        return;
    }

    container.innerHTML = recent.map(e => {
        const agentData = state.agents.get(e.agentId);
        const color = agentData?.color || (e.isMesh ? '#6cf' : '#888');
        const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const meshBadge = e.isMesh ? ' <span style="font-size:9px;opacity:0.6">🌐</span>' : '';
        const deleteBtn = e.localIndex != null ? `<span class="ring-entry-delete" onclick="deleteRingEntry(${e.localIndex})" title="Delete this entry">✕</span>` : '';
        return `
            <div class="ring-entry">
                <div class="ring-entry-header">
                    <span class="ring-entry-agent" style="color:${color}">${e.agentId}${meshBadge}</span>
                    <div class="ring-entry-meta">
                        <span class="ring-entry-time">${time}</span>
                        ${deleteBtn}
                    </div>
                </div>
                <div class="ring-entry-content">${escapeHtml(e.content.slice(0, 150))}${e.content.length > 150 ? '...' : ''}</div>
            </div>
        `;
    }).join('');
}
