# KAA Multi-Agent Test Plan

## Overview

Testing the KAA (Keep Agents Aligned) 3-agent delegation pattern where a coordinator agent delegates planning and coding to specialist agents, with pipeline progress tracked visually.

## Test Environment

- URL: https://jsamuel1.github.io/agi-diy/agi.html
- Provider: Amazon Bedrock
- Model: `global.anthropic.claude-opus-4-6-v1` (all 3 agents)
- Browser control: Chrome DevTools MCP (evaluate_script, take_snapshot, fill, press_key)

## Pre-Test Setup

1. Navigate to the GitHub Pages URL with cache bypass
2. Clear all existing agents from localStorage (keep credentials):
   ```javascript
   const stored = JSON.parse(localStorage.getItem('agi_multi_state') || '{}');
   stored.agents = [];
   localStorage.setItem('agi_multi_state', JSON.stringify(stored));
   location.reload();
   ```
3. Wait for page reload, check console for errors

## Agent Configurations

### kaa-planner

- **Role**: Software architect — breaks tasks into pipeline subtasks
- **System Prompt**:
  ```
  You are kaa-planner, a software architect. Break tasks into pipeline subtasks
  using create_pipeline and add_task. Set dependencies with dependsOn.
  Never write code. Return the pipeline ID when done.
  ```
- **Enabled Tools**: `create_pipeline`, `add_task`, `update_task_status`, `read_pipeline`
- **Key constraint**: Never writes code, only creates pipeline structure

### kaa-coding

- **Role**: Implementation specialist — builds one task at a time
- **System Prompt**:
  ```
  You are kaa-coding. Implement ONE task at a time from the pipeline.
  Use sandbox tools to test. Mark tasks complete with update_task_status.
  ```
- **Enabled Tools**: `create_pipeline`, `add_task`, `update_task_status`, `read_pipeline`, `javascript_eval`, `render_ui`, `sandbox_create`, `sandbox_update`, `sandbox_read`, `sandbox_list`, `sandbox_delete`
- **Key constraint**: Implements tasks, marks them done via pipeline tools

### kaa-chat

- **Role**: Project coordinator — delegates, never implements
- **System Prompt**:
  ```
  You are kaa-chat, a project coordinator in a multi-agent team.
  You do NOT write code or generate implementations yourself.

  When a user asks you to build or create something:
  1. First call list_agents to discover what specialist agents are available
  2. Then call invoke_agent to delegate the work to the appropriate specialist
  3. Monitor progress by checking read_pipeline

  For planning tasks, delegate to the planner agent. For implementation,
  delegate to the coding agent. Always delegate — never attempt the work yourself.
  ```
- **Enabled Tools**: `list_agents`, `invoke_agent`, `read_pipeline`
- **Key constraint**: Only 3 tools — cannot write code, forced to delegate

## Spawning Agents

All 3 agents are spawned programmatically via `window.spawnAgent(id, config)`:

```javascript
await window.spawnAgent('kaa-planner', {
  systemPrompt: '...',
  provider: 'bedrock',
  modelId: 'global.anthropic.claude-opus-4-6-v1',
  enabledTools: ['create_pipeline', 'add_task', 'update_task_status', 'read_pipeline']
});

await window.spawnAgent('kaa-coding', {
  systemPrompt: '...',
  provider: 'bedrock',
  modelId: 'global.anthropic.claude-opus-4-6-v1',
  enabledTools: ['create_pipeline', 'add_task', 'update_task_status', 'read_pipeline',
    'javascript_eval', 'render_ui', 'sandbox_create', 'sandbox_update',
    'sandbox_read', 'sandbox_list', 'sandbox_delete']
});

await window.spawnAgent('kaa-chat', {
  systemPrompt: '...',
  provider: 'bedrock',
  modelId: 'global.anthropic.claude-opus-4-6-v1',
  enabledTools: ['list_agents', 'invoke_agent', 'read_pipeline']
});
```

## Test Execution

1. Select `kaa-chat` from the agent dropdown
2. Type test prompt into the message input: **"Build a kanban board app"**
3. Press Enter to send

## Expected Flow

```
User → kaa-chat: "Build a kanban board app"
  kaa-chat calls list_agents → discovers kaa-planner, kaa-coding
  kaa-chat calls invoke_agent(kaa-planner, "Build a kanban board app")
    kaa-planner calls create_pipeline → creates pipeline with tasks
    kaa-planner calls add_task × N → adds tasks with dependencies
    kaa-planner returns pipeline ID
  kaa-chat calls invoke_agent(kaa-coding, "Implement pipeline <id>")
    kaa-coding calls read_pipeline → sees tasks
    kaa-coding calls update_task_status(task, 'working')
    kaa-coding calls sandbox_create → builds the app
    kaa-coding calls update_task_status(task, 'done')
    ... repeats for each task
  kaa-chat reports completion to user
```

## What to Observe

### Pipeline Flow (above chat)
- Should appear when `create_pipeline` is called
- Boxes should transition: dashed (pending) → pulsing (working) → green (done)
- Edges between boxes should color-code with progress
- Back-lines (dashed red) should appear for any backward dependencies

### Pipeline Side Panel (right)
- Pills should update in real-time as tasks change status
- Activity log should show status messages from agents

### Sandbox Preview
- App should render inline in chat at 500px height
- 🖼️ Preview button should toggle fullscreen background mode
- Expand button (↕) should toggle between 500px and 80vh

### Agent Statuses (sidebar)
- Should show PROCESSING while agents are working
- Should return to READY when done

## Monitoring During Test

Poll agent state every 30-60 seconds:
```javascript
() => {
  const toolCalls = document.querySelectorAll('.tool-call');
  const tools = Array.from(toolCalls).map(t => ({
    name: t.querySelector('.tool-name')?.textContent,
    status: t.querySelector('.tool-status')?.textContent
  }));
  const statuses = [];
  document.querySelectorAll('.agent-status').forEach(el => statuses.push(el.textContent));
  const msgs = document.querySelectorAll('.message');
  const last = msgs.length > 0 ? msgs[msgs.length - 1].textContent.substring(0, 500) : '';
  return { toolCallCount: toolCalls.length, tools, statuses, lastMessage: last };
}
```

## Previous Test Results

### Test 1 (before fixes)
- kaa-chat DID call list_agents and invoke_agent ✅
- kaa-planner DID create a pipeline with 8 tasks across 7 layers ✅
- kaa-coding DID implement and produce a kanban board ✅
- Pipeline flow bar never appeared ❌ (tool name mismatch — agents couldn't call pipeline tools)
- Pipeline side panel never updated ❌ (same root cause)
- Sandbox rendered inline but too small ❌

### Root Cause
Spawn configs used wrong tool names:
- `add_pipeline_task` → should be `add_task`
- `update_pipeline_task` → should be `update_task_status`
- `get_pipeline` → should be `read_pipeline`

These are fixed in this test plan.

## Changes Since Last Test

- `af1bdfc`: Preview mode (sandbox as background) + pipeline back-lines
- `9c6ec65`: Pipeline flow visualization above chat + larger sandbox (500px/80vh)
- `9804589`: Model catalog with autocomplete + per-model feature flags
