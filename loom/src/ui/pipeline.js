// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE MODEL — getPipelines, topoSort, renderPipelineFlow, updatePipelineUI
// ═══════════════════════════════════════════════════════════════════════════

import { TASK_COLORS } from '../state/store.js';

export function getPipelines() { try { return JSON.parse(localStorage.getItem('agi_pipelines') || '{}'); } catch { return {}; } }
export function savePipelines(p) { localStorage.setItem('agi_pipelines', JSON.stringify(p)); }
export function getActivePipeline(pipelines) { const p = pipelines || getPipelines(); const keys = Object.keys(p); return keys.length ? p[keys[keys.length - 1]] : null; }

export function getReadyTasks(pipeline) {
    return pipeline.tasks.filter(t => t.status === 'pending' && t.dependsOn.every(d => pipeline.tasks.find(x => x.id === d)?.status === 'done'));
}

export function topoSort(tasks) {
    const visited = new Set(), result = [], taskMap = Object.fromEntries(tasks.map(t => [t.id, t]));
    function visit(id) { if (visited.has(id)) return; visited.add(id); const t = taskMap[id]; if (t) { t.dependsOn.forEach(visit); result.push(t); } }
    tasks.forEach(t => visit(t.id));
    return result;
}

export function renderPipelinePills(pipeline) {
    const el = document.getElementById('pipelinePills');
    if (!pipeline) { el.innerHTML = ''; return; }
    el.innerHTML = '';
    topoSort(pipeline.tasks).forEach((task, i) => {
        if (i > 0) { const c = document.createElement('span'); c.className = 'phase-connector'; el.appendChild(c); }
        const pill = document.createElement('span');
        pill.className = `phase-pill phase-${task.status}`;
        if (task.status === 'working') pill.style.setProperty('--task-color', task.color || TASK_COLORS.custom);
        pill.textContent = task.name;
        pill.onclick = () => { const h = document.querySelector(`[data-task-id="${task.id}"]`); if (h) h.scrollIntoView({ behavior: 'smooth' }); };
        el.appendChild(pill);
    });
}

export function renderPipelineActivity() {
    const pipeline = getActivePipeline();
    const log = document.getElementById('activityLog');
    if (!pipeline) { log.innerHTML = '<div class="pipeline-empty">No active pipeline. Agents will create one for complex tasks.</div>'; return; }
    log.innerHTML = '';
    const active = pipeline.tasks.filter(t => t.activities && t.activities.length > 0).sort((a, b) => a.activities[0].ts - b.activities[0].ts);
    active.forEach(task => {
        const h = document.createElement('div');
        h.className = 'activity-heading'; h.dataset.taskId = task.id;
        h.style.color = task.status === 'done' ? '#00ff88' : (task.color || '#ccc');
        h.textContent = task.name;
        log.appendChild(h);
        task.activities.forEach(a => {
            const line = document.createElement('div');
            line.className = 'activity-line';
            if (a.done) { line.style.color = '#00ff88'; line.textContent = a.text + ' ✓'; }
            else { line.textContent = a.text; }
            log.appendChild(line);
        });
    });
    log.scrollTop = log.scrollHeight;
    renderCompletionCards(pipeline);
}

export function renderCompletionCards(pipeline) {
    const el = document.getElementById('completionCards');
    if (!pipeline.completionActions || !pipeline.completionActions.length) { el.style.display = 'none'; return; }
    el.style.display = 'flex'; el.innerHTML = '';
    pipeline.completionActions.forEach(a => {
        const card = document.createElement('a');
        card.className = 'completion-card'; card.href = a.url || '#'; card.target = '_blank';
        card.innerHTML = `<strong>${a.label}</strong><span>${a.description || ''}</span>`;
        el.appendChild(card);
    });
}

export function renderPipelineFlow(pipeline) {
    const el = document.getElementById('pipelineFlow');
    if (!pipeline || !pipeline.tasks.length) { el.classList.remove('active'); el.innerHTML = ''; return; }
    el.classList.add('active');
    const sorted = topoSort(pipeline.tasks);
    const idxMap = {}; sorted.forEach((t, i) => idxMap[t.id] = i);
    const inner = document.createElement('div');
    inner.className = 'pipeline-flow-inner';

    // Clear button
    const clearBtn = document.createElement('span');
    clearBtn.textContent = '×';
    clearBtn.style.cssText = 'cursor:pointer;color:#666;font-size:16px;margin-right:8px;flex-shrink:0;';
    clearBtn.onclick = () => {
        localStorage.removeItem('agi_pipelines');
        updatePipelineUI();
        // Reset activity filter
        const sel = document.getElementById('activityFilter');
        if (sel) sel.value = 'all';
    };
    inner.appendChild(clearBtn);

    const nodeEls = [];
    sorted.forEach((task, i) => {
        if (i > 0) {
            const edge = document.createElement('span');
            edge.className = 'pf-edge' + (task.status === 'done' || task.status === 'success' ? ' done' : task.status === 'working' ? ' working' : '');
            inner.appendChild(edge);
        }
        const node = document.createElement('span');
        node.className = 'pf-node ' + task.status;
        node.dataset.taskId = task.id;
        node.style.cursor = 'pointer';
        if (task.status === 'working') node.style.setProperty('--task-color', task.color || '#ffaa00');
        const label = document.createElement('span');
        label.textContent = task.name.split(' — ')[0].split(' - ')[0];
        node.appendChild(label);
        node.onclick = () => {
            const sel = document.getElementById('activityFilter');
            if (!sel.querySelector(`option[value="task:${task.id}"]`)) {
                sel.add(new Option(task.name.split(' — ')[0], 'task:' + task.id));
            }
            sel.value = 'task:' + task.id;
            // filterActivityFeed will be called by the change handler
            sel.dispatchEvent(new Event('change'));
        };
        inner.appendChild(node);
        nodeEls.push(node);
    });
    el.innerHTML = '';
    el.appendChild(inner);

    // Scroll active node into view
    requestAnimationFrame(() => {
        const target = inner.querySelector('.pf-node.working') || inner.querySelector('.pf-node.partial') || inner.querySelector('.pf-node.pending');
        if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });

    // Draw back-lines for backward deps
    requestAnimationFrame(() => {
        sorted.forEach((task, i) => {
            task.dependsOn.forEach(depId => {
                const di = idxMap[depId];
                if (di !== undefined && di > i) {
                    const from = nodeEls[i], to = nodeEls[di];
                    if (!from || !to) return;
                    const pr = inner.getBoundingClientRect(), fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
                    const line = document.createElement('div');
                    line.className = 'pf-back';
                    line.style.left = (fr.left - pr.left + fr.width / 2) + 'px';
                    line.style.width = (tr.left - fr.left) + 'px';
                    line.style.top = (fr.bottom - pr.top + 2) + 'px';
                    line.style.height = '10px';
                    line.style.borderTop = 'none';
                    inner.appendChild(line);
                }
            });
        });
    });
}

export function updatePipelineUI() {
    const p = getActivePipeline();
    renderPipelinePills(p);
    renderPipelineActivity();
    renderPipelineFlow(p);
}
