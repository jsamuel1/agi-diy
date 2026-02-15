// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE TOOLS — create_pipeline, add_task, update_task_status, etc.
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { TASK_COLORS } from '../state/store.js';
import { getPipelines, savePipelines, getActivePipeline, getReadyTasks, updatePipelineUI, renderPipelineActivity } from '../ui/pipeline.js';

export const createPipelineTool = tool({
    name: 'create_pipeline', description: 'Create a pipeline with tasks and dependencies.',
    inputSchema: z.object({ name: z.string(), tasks: z.array(z.object({ id: z.string(), name: z.string(), dependsOn: z.array(z.string()).default([]), color: z.string().optional() })) }),
    callback: async (input) => {
        const id = 'pipe-' + Date.now().toString(36);
        const pipelines = getPipelines();
        pipelines[id] = { id, name: input.name, tasks: input.tasks.map(t => ({ ...t, status: 'pending', assignedTo: null, color: t.color || TASK_COLORS[t.id] || TASK_COLORS.custom, activities: [] })), completionActions: [] };
        savePipelines(pipelines); updatePipelineUI();
        return { created: id, readyTasks: getReadyTasks(pipelines[id]).map(t => t.id) };
    }
});

export const readPipelineTool = tool({
    name: 'read_pipeline', description: 'Read the current active pipeline state.',
    inputSchema: z.object({}),
    callback: async () => { const p = getActivePipeline(); return p || { error: 'No active pipeline' }; }
});

export const addTaskTool = tool({
    name: 'add_task', description: 'Add a task to the active pipeline.',
    inputSchema: z.object({ id: z.string(), name: z.string(), dependsOn: z.array(z.string()).default([]), color: z.string().optional() }),
    callback: async (input) => {
        const pipelines = getPipelines(); const p = getActivePipeline(pipelines);
        if (!p) return { error: 'No active pipeline' };
        p.tasks.push({ id: input.id, name: input.name, dependsOn: input.dependsOn, status: 'pending', assignedTo: null, color: input.color || TASK_COLORS[input.id] || TASK_COLORS.custom, activities: [] });
        savePipelines(pipelines); updatePipelineUI();
        return { added: input.id, readyTasks: getReadyTasks(p).map(t => t.id) };
    }
});

export const updateTaskStatusTool = tool({
    name: 'update_task_status', description: 'Update a pipeline task status.',
    inputSchema: z.object({ taskId: z.string(), status: z.enum(['pending','working','done','success','error','failed','partial']), agentId: z.string().optional(), activity: z.string().optional() }),
    callback: async (input) => {
        const pipelines = getPipelines(); const p = getActivePipeline(pipelines);
        if (!p) return { error: 'No active pipeline' };
        const task = p.tasks.find(t => t.id === input.taskId);
        if (!task) return { error: 'Task not found' };
        if (input.status === 'working' && task.assignedTo && task.assignedTo !== input.agentId) return { error: `Locked by ${task.assignedTo}` };
        task.status = input.status;
        task.assignedTo = input.status === 'working' ? (input.agentId || null) : null;
        if (input.activity) task.activities.push({ text: input.activity, ts: Date.now(), done: input.status === 'done' });
        savePipelines(pipelines); updatePipelineUI();
        return { updated: input.taskId, status: input.status, readyTasks: getReadyTasks(p).map(t => t.id) };
    }
});

export const updateTaskDepsTool = tool({
    name: 'update_task_deps', description: "Change a task's dependencies.",
    inputSchema: z.object({ taskId: z.string(), dependsOn: z.array(z.string()) }),
    callback: async (input) => {
        const pipelines = getPipelines(); const p = getActivePipeline(pipelines);
        if (!p) return { error: 'No active pipeline' };
        const task = p.tasks.find(t => t.id === input.taskId);
        if (!task) return { error: 'Task not found' };
        task.dependsOn = input.dependsOn;
        savePipelines(pipelines); updatePipelineUI();
        return { updated: input.taskId, dependsOn: input.dependsOn };
    }
});

export const completePipelineTool = tool({
    name: 'complete_pipeline', description: 'Mark pipeline complete and set action cards.',
    inputSchema: z.object({ actions: z.array(z.object({ label: z.string(), description: z.string().optional(), url: z.string().optional() })).optional() }),
    callback: async (input) => {
        const pipelines = getPipelines(); const p = getActivePipeline(pipelines);
        if (!p) return { error: 'No active pipeline' };
        p.completionActions = input.actions || [];
        savePipelines(pipelines); updatePipelineUI();
        return { completed: p.id };
    }
});

export const emitStatusTool = tool({
    name: 'emit_status', description: 'Emit a short status update for the pipeline activity log.',
    inputSchema: z.object({ taskId: z.string(), text: z.string(), done: z.boolean().optional() }),
    callback: async (input) => {
        const pipelines = getPipelines(); const p = getActivePipeline(pipelines);
        if (!p) return { error: 'No active pipeline' };
        const task = p.tasks.find(t => t.id === input.taskId);
        if (!task) return { error: 'Task not found' };
        task.activities.push({ text: input.text, ts: Date.now(), done: input.done || false });
        savePipelines(pipelines); renderPipelineActivity();
        return { emitted: true };
    }
});
