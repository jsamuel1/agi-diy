// ═══════════════════════════════════════════════════════════════════════════
// SELF-MODIFICATION — create_tool, update_self, list_tools, delete_tool, custom tools
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { state } from '../state/store.js';
import * as db from '../sync/db.js';

let _saveState = null;
export function setSelfModCallbacks({ saveState }) { _saveState = saveState; }

// In-memory cache — loaded from IDB at startup, written through on changes
let _customTools = null;

export function loadCustomTools() {
    return _customTools || {};
}

export function saveCustomTools(tools) {
    _customTools = tools;
    db.putMeta('customTools', tools).catch(e => console.warn('[loom] custom tools save failed:', e));
}

export async function initCustomTools() {
    _customTools = (await db.getMeta('customTools')) || {};
}

// ─── Web Worker sandbox for custom tool execution ───

const SANDBOX_WORKER_CODE = `
self.onmessage = async (e) => {
    const { code, input } = e.data;
    try {
        const fn = new Function('input', 'return (async () => { ' + code + ' })()');
        const result = await fn(input);
        self.postMessage({ result });
    } catch (err) {
        self.postMessage({ error: err.message || String(err) });
    }
};`;

let _workerUrl = null;
function getWorkerUrl() {
    if (!_workerUrl)
        _workerUrl = URL.createObjectURL(new Blob([SANDBOX_WORKER_CODE], { type: 'application/javascript' }));
    return _workerUrl;
}

function runInSandbox(code, input, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(getWorkerUrl());
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`Tool execution timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
        worker.onmessage = (e) => {
            clearTimeout(timer);
            worker.terminate();
            if (e.data.error) reject(new Error(e.data.error));
            else resolve(e.data.result);
        };
        worker.onerror = (e) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(e.message || 'Worker error'));
        };
        worker.postMessage({ code, input });
    });
}

// ─── Tool definition builder ───

export function createToolFromDefinition(name, def) {
    try {
        const schemaObj = {};
        for (const [key, prop] of Object.entries(def.inputSchema.properties || {})) {
            let zodType;
            switch (prop.type) {
                case 'number': zodType = z.number(); break;
                case 'boolean': zodType = z.boolean(); break;
                case 'array': zodType = z.array(z.any()); break;
                case 'object': zodType = z.object({}).passthrough(); break;
                default: zodType = z.string();
            }
            if (prop.description) zodType = zodType.describe(prop.description);
            if (!(def.inputSchema.required || []).includes(key)) zodType = zodType.optional();
            schemaObj[key] = zodType;
        }
        const callbackFn = async (input) => {
            try {
                return await runInSandbox(def.code, input);
            } catch (e) {
                return { error: e.message };
            }
        };
        return tool({ name, description: def.description, inputSchema: z.object(schemaObj), callback: callbackFn });
    } catch (e) { console.error(`Failed to create tool ${name}:`, e); return null; }
}

export function buildCustomTools() {
    const customToolDefs = loadCustomTools();
    const tools = [];
    for (const [name, def] of Object.entries(customToolDefs)) {
        const t = createToolFromDefinition(name, def);
        if (t) tools.push(t);
    }
    return tools;
}

export const updateSelfTool = tool({
    name: 'update_self',
    description: 'Update agent configuration (system prompt, etc.)',
    inputSchema: z.object({
        section: z.enum(['system_prompt', 'config']).describe('Section'),
        content: z.string().describe('Content'),
        action: z.enum(['replace', 'append', 'prepend']).optional()
    }),
    callback: async (input, { agent }) => {
        const action = input.action || 'replace';
        let callerAgentId = state.activeAgentId;
        for (const [id, data] of state.agents) { if (data.agent === agent) { callerAgentId = id; break; } }
        const agentData = state.agents.get(callerAgentId);
        if (!agentData) return { error: 'Agent not found' };
        if (input.section === 'system_prompt') {
            const current = agentData.config.systemPrompt || '';
            agentData.config.systemPrompt = action === 'append' ? current + '\n' + input.content : action === 'prepend' ? input.content + '\n' + current : input.content;
            if (_saveState) _saveState();
            return { success: true, message: `System prompt updated for agent ${callerAgentId}.` };
        }
        return { error: `Unknown section: ${input.section}` };
    }
});

export const createToolTool = tool({
    name: 'create_tool',
    description: `Create a new tool available to all agents. Persists across sessions. 'code' is the body of an async function receiving 'input'. Return a result object.`,
    inputSchema: z.object({
        name: z.string(), description: z.string(),
        inputSchema: z.object({ type: z.literal('object'), properties: z.record(z.string(), z.object({ type: z.string(), description: z.string().optional() })), required: z.array(z.string()).optional() }),
        code: z.string()
    }),
    callback: async (input) => {
        try {
            if (!/^[a-z][a-z0-9_]*$/.test(input.name)) return { error: 'Tool name must be snake_case' };
            const reserved = ['create_tool','list_tools','delete_tool','update_self','render_ui','javascript_eval','storage_get','storage_set','fetch_url','notify','use_agent','scheduler','invoke_agent','broadcast_to_agents','list_agents','invoke_remote_agent','subscribe_topic','publish_topic'];
            if (reserved.includes(input.name)) return { error: `Cannot override built-in tool: ${input.name}` };
            try { new Function('input', input.code); } catch (e) { return { error: `Invalid JavaScript code: ${e.message}` }; }
            const customTools = loadCustomTools();
            const toolDef = { description: input.description, inputSchema: input.inputSchema, code: input.code, createdAt: new Date().toISOString() };
            customTools[input.name] = toolDef;
            saveCustomTools(customTools);
            const newTool = createToolFromDefinition(input.name, toolDef);
            if (newTool) { for (const [, agentData] of state.agents) { if (agentData.agent?.tools) agentData.agent.tools.push(newTool); } }
            return { success: true, message: `Tool '${input.name}' created and ready!`, tool: input.name };
        } catch (e) { return { error: e.message }; }
    }
});

export const listToolsTool = tool({
    name: 'list_tools',
    description: 'List all available tools, including custom tools',
    inputSchema: z.object({ includeBuiltIn: z.boolean().optional() }),
    callback: async (input = {}) => {
        const result = { custom: [], builtIn: [] };
        for (const [name, def] of Object.entries(loadCustomTools())) result.custom.push({ name, description: def.description, createdAt: def.createdAt });
        if (input?.includeBuiltIn !== false) result.builtIn = ['render_ui','javascript_eval','storage_get','storage_set','fetch_url','notify','update_self','create_tool','list_tools','delete_tool','use_agent','scheduler','invoke_agent','broadcast_to_agents','list_agents','invoke_remote_agent','subscribe_topic','publish_topic'];
        return result;
    }
});

export const deleteToolTool = tool({
    name: 'delete_tool',
    description: 'Delete a custom tool',
    inputSchema: z.object({ name: z.string() }),
    callback: async (input) => {
        const customTools = loadCustomTools();
        if (!customTools[input.name]) return { error: `Tool '${input.name}' not found` };
        delete customTools[input.name];
        saveCustomTools(customTools);
        return { success: true, message: `Tool '${input.name}' deleted.` };
    }
});
