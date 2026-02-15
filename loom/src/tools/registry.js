// ═══════════════════════════════════════════════════════════════════════════
// TOOLS REGISTRY — Assembles the TOOLS array from all tool modules
// ═══════════════════════════════════════════════════════════════════════════

import { renderUiTool, javascriptEvalTool, storageGetTool, storageSetTool, fetchUrlTool, notifyTool, useAgentTool, schedulerTool } from './core.js';
import { updateSelfTool, createToolTool, listToolsTool, deleteToolTool } from './self-mod.js';
import { invokeAgentTool, broadcastToAgentsTool, listAgentsTool, invokeRemoteAgentTool, subscribeTopicTool, publishTopicTool } from './mesh.js';
import { MESH_TOOLS } from './cross-tab.js';
import { createPipelineTool, readPipelineTool, addTaskTool, updateTaskStatusTool, updateTaskDepsTool, completePipelineTool, emitStatusTool } from './pipeline.js';
import { sandboxCreateTool, sandboxUpdateTool, sandboxReadTool, sandboxListTool, sandboxDeleteTool } from './sandbox.js';
import { githubSearchTool, githubReadFileTool, githubListReposTool, githubCreateIssueTool, githubListIssuesTool, githubCreatePrTool, githubReadPrTool } from './github.js';

export const TOOLS = [
    // Core
    renderUiTool, javascriptEvalTool, storageGetTool, storageSetTool, fetchUrlTool, notifyTool,
    // Self-modification
    updateSelfTool, createToolTool, listToolsTool, deleteToolTool,
    // Agent management
    useAgentTool, schedulerTool,
    // Mesh communication (local + remote)
    invokeAgentTool, broadcastToAgentsTool, listAgentsTool, invokeRemoteAgentTool, subscribeTopicTool, publishTopicTool,
    // Cross-tab mesh
    ...MESH_TOOLS,
    // Pipeline
    createPipelineTool, readPipelineTool, addTaskTool, updateTaskStatusTool, updateTaskDepsTool, completePipelineTool, emitStatusTool,
    // Sandbox
    sandboxCreateTool, sandboxUpdateTool, sandboxReadTool, sandboxListTool, sandboxDeleteTool,
    // GitHub
    githubSearchTool, githubReadFileTool, githubListReposTool, githubCreateIssueTool, githubListIssuesTool, githubCreatePrTool, githubReadPrTool
];

// Tool descriptions for spawn/edit modals
export const TOOL_DESCRIPTIONS = [
    { name: 'render_ui', desc: 'Render HTML/CSS/JS' }, { name: 'javascript_eval', desc: 'Execute JavaScript' },
    { name: 'storage_get', desc: 'Get localStorage' }, { name: 'storage_set', desc: 'Set localStorage' },
    { name: 'fetch_url', desc: 'HTTP requests' }, { name: 'notify', desc: 'Browser notifications' },
    { name: 'update_self', desc: 'Modify system prompt' }, { name: 'create_tool', desc: 'Create new tools' },
    { name: 'list_tools', desc: 'List all tools' }, { name: 'delete_tool', desc: 'Delete custom tools' },
    { name: 'use_agent', desc: 'Create sub-agents' }, { name: 'scheduler', desc: 'Schedule tasks' },
    { name: 'invoke_agent', desc: 'Call another agent' }, { name: 'broadcast_to_agents', desc: 'Broadcast to all' },
    { name: 'list_agents', desc: 'List all agents' }, { name: 'invoke_remote_agent', desc: 'Call remote agent' },
    { name: 'subscribe_topic', desc: 'Subscribe to topic' }, { name: 'publish_topic', desc: 'Publish to topic' },
    { name: 'create_pipeline', desc: 'Create pipeline' }, { name: 'read_pipeline', desc: 'Read pipeline' },
    { name: 'add_task', desc: 'Add pipeline task' }, { name: 'update_task_status', desc: 'Update task status' },
    { name: 'update_task_deps', desc: 'Update task deps' }, { name: 'complete_pipeline', desc: 'Complete pipeline' },
    { name: 'emit_status', desc: 'Emit status update' },
    { name: 'sandbox_create', desc: 'Create sandbox' }, { name: 'sandbox_update', desc: 'Update sandbox' },
    { name: 'sandbox_read', desc: 'Read sandbox' }, { name: 'sandbox_list', desc: 'List sandboxes' },
    { name: 'sandbox_delete', desc: 'Delete sandbox' },
    { name: 'github_search', desc: 'Search GitHub' }, { name: 'github_read_file', desc: 'Read repo file' },
    { name: 'github_list_repos', desc: 'List repos' }, { name: 'github_create_issue', desc: 'Create issue' },
    { name: 'github_list_issues', desc: 'List issues' }, { name: 'github_create_pr', desc: 'Create PR' },
    { name: 'github_read_pr', desc: 'Read PR details' }
];
