// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY FEED — appendActivityFeed, filterActivityFeed, activityLog[]
// ═══════════════════════════════════════════════════════════════════════════

import { state } from '../state/store.js';
import { escapeHtml } from './toast.js';
import { getActivePipeline } from './pipeline.js';

export const activityLog = []; // { agentId, text, type, ts, color, extra }

export function appendActivityFeed(agentId, text, type = 'msg', extra = null) {
    const agentData = state.agents.get(agentId);
    activityLog.push({ agentId, text, type, ts: Date.now(), color: agentData?.color || '#888', extra });
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    const filter = document.getElementById('activityFilter')?.value;
    if (filter && filter !== 'all' && filter !== agentId && !filter.startsWith('task:')) return;
    renderActivityEntry(feed, activityLog[activityLog.length - 1]);
    feed.scrollTop = feed.scrollHeight;
}

export function renderActivityEntry(feed, entry) {
    if (!feed._lastAgent || feed._lastAgent !== entry.agentId) {
        const h = document.createElement('div');
        h.className = 'af-agent';
        h.innerHTML = `<span class="message-role">agi</span><span class="message-agent" style="background:${entry.color}20;color:${entry.color}">${entry.agentId}</span>`;
        feed.appendChild(h);
        feed._lastAgent = entry.agentId;
    }
    const idx = activityLog.indexOf(entry);
    const line = document.createElement('div');
    line.className = entry.type === 'tool' ? 'af-tool tool-block' : 'af-msg';
    if (idx >= 0) line.id = 'af-' + idx;
    line.style.setProperty('--agent-color', entry.color);
    if (entry.type === 'tool' && entry.extra) {
        const hdr = document.createElement('div');
        hdr.className = 'tool-header';
        hdr.innerHTML = `<div class="tool-status"></div><span class="tool-name">${escapeHtml(entry.text)}</span>`;
        line.appendChild(hdr);
        if (entry.extra.input) {
            const d = document.createElement('details');
            d.innerHTML = `<summary style="cursor:pointer;color:var(--text-tertiary);font-size:10px;margin-top:4px">input</summary><div class="tool-input">${escapeHtml(JSON.stringify(entry.extra.input, null, 2).substring(0, 2000))}</div>`;
            line.appendChild(d);
        }
        if (entry.extra.output) {
            const d = document.createElement('details');
            const out = typeof entry.extra.output === 'string' ? entry.extra.output : JSON.stringify(entry.extra.output, null, 2);
            d.innerHTML = `<summary style="cursor:pointer;color:var(--text-tertiary);font-size:10px;margin-top:4px">output</summary><div class="tool-input">${escapeHtml(out.substring(0, 2000))}</div>`;
            line.appendChild(d);
        }
    } else {
        line.textContent = entry.text.length > 500 ? entry.text.substring(0, 500) + '…' : entry.text;
    }
    // Replace existing or append
    const existing = idx >= 0 ? document.getElementById('af-' + idx) : null;
    if (existing) existing.replaceWith(line);
    else feed.appendChild(line);
}

export function filterActivityFeed() {
    const filter = document.getElementById('activityFilter').value;
    const feed = document.getElementById('activityFeed');
    feed.innerHTML = '';
    feed._lastAgent = null;
    if (filter.startsWith('task:')) {
        const p = getActivePipeline();
        const task = p?.tasks.find(t => t.id === filter.substring(5));
        if (!task) return;
        const h = document.createElement('div');
        h.className = 'af-agent';
        h.style.color = task.color || '#ccc';
        h.textContent = `${task.name} [${task.status}]${task.assignedTo ? ' → ' + task.assignedTo : ''}`;
        feed.appendChild(h);
        (task.activities || []).forEach(a => {
            const line = document.createElement('div');
            line.className = a.done ? 'af-msg' : 'af-tool';
            line.style.setProperty('--agent-color', task.color || '#555');
            line.textContent = (a.done ? '✓ ' : '') + a.text;
            feed.appendChild(line);
        });
        activityLog.filter(e => e.text.includes(task.name.split(' — ')[0])).forEach(e => renderActivityEntry(feed, e));
        return;
    }
    const entries = filter === 'all' ? activityLog : activityLog.filter(e => e.agentId === filter);
    entries.forEach(e => renderActivityEntry(feed, e));
    feed.scrollTop = feed.scrollHeight;
}

export function updateActivityFilterOptions() {
    const sel = document.getElementById('activityFilter');
    if (!sel) return;
    const val = sel.value;
    const opts = ['<option value="all">All Agents</option>'];
    for (const [id, data] of state.agents) {
        opts.push(`<option value="${id}" style="color:${data.color}">${id}</option>`);
    }
    if (val.startsWith('task:')) {
        const p = getActivePipeline();
        const task = p?.tasks.find(t => t.id === val.substring(5));
        if (task) opts.push(`<option value="${val}">${task.name.split(' — ')[0]}</option>`);
    }
    sel.innerHTML = opts.join('');
    sel.value = val;
}
