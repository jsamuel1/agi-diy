# Implementation Plan: Enhanced Multi-Agent System

Bringing hierarchical agent patterns (from KAA POC) and pipeline-driven workflow
visualization into agi.diy's browser-based multi-agent system.

## Design Reference

The visualization follows a split-panel layout observed in a planner-agent UI:

- **Left panel**: Chat — user submits tasks, steers agents mid-execution
- **Right panel**: Pipeline visualization + streaming activity log
- **Pipeline**: Horizontal phase pills (dashed=pending, colored=active, solid=done)
- **Activity log**: Phase-colored headings with streaming status lines and ✓ completion
- **Phases repeat**: Code→Review→Code→Review cycles shown as repeated headings
- **Dynamic phases**: User interrupts spawn new phases or work streams in real-time
- **Completion**: Action cards (Open PR, Open in IDE, Run in CloudShell)

## Constraints

- All code runs in the browser (vanilla JS, no build step)
- JS Strands SDK has hooks (`BeforeToolCallEvent`, `BeforeModelCallEvent`, etc.)
  but NO `interrupt()` and NO `SummarizingConversationManager`
- Current `agi.html` is a single file (~2800 lines)

---

## Phase 1: Pipeline Data Model + Status Emission

**Goal:** Give agents a dependency-graph pipeline and a way to emit status
updates. Colors are driven by state, not assigned per-task.

### 1a. Pipeline Data Model

A pipeline is a DAG of tasks. Each task declares what it depends on. Tasks with
all dependencies met can run in parallel — no explicit parallel flags needed.

```javascript
// localStorage key: 'agi_pipelines'
{
  "pipe-xxxx": {
    id: "pipe-xxxx",
    name: "Add tail command to CLI",
    repo: "romdr/ghosty-beam",
    tasks: [
      { id: "req",    name: "Requirements",       status: "done",    dependsOn: [],         assignedTo: null, color: "#00ff88", activities: [...] },
      { id: "plan",   name: "Technical Planning",  status: "done",    dependsOn: ["req"],    assignedTo: null, color: "#9966ff", activities: [...] },
      { id: "code",   name: "Coding",              status: "working", dependsOn: ["plan"],   assignedTo: "coder", color: "#ff8800", activities: [...] },
      { id: "test",   name: "Testing",             status: "pending", dependsOn: ["code"],   assignedTo: null, color: "#00cccc", activities: [...] },
      { id: "review", name: "Code Review",         status: "pending", dependsOn: ["test"],   assignedTo: null, color: "#00ff88", activities: [...] },
      { id: "pr",     name: "PR",                  status: "pending", dependsOn: ["review"], assignedTo: null, color: "#00ff88", activities: [...] }
    ],
    completionActions: []
  }
}
```

**Task statuses → pill styles (state-driven):**

| Status | Pill Style |
|--------|-----------|
| `pending` | Dashed border, dim text |
| `working` | Solid border in task color, bright text, pulse animation |
| `done` | Solid green border + green fill tint, green text |
| `error` | Solid red border, red text |

Each task is assigned a color at creation for visual distinction when active.
Standard palette (matching reference UI):

```javascript
const TASK_COLORS = {
  requirements: '#00ff88',   // green
  planning:     '#9966ff',   // purple
  coding:       '#ff8800',   // orange
  testing:      '#00cccc',   // teal
  review:       '#00ff88',   // green
  pr:           '#00ff88',   // green
  docs:         '#00ff88',   // green
  custom:       '#ffaa00'    // amber (fallback)
};
```

**Adding work from interrupts** — just add tasks with dependencies:

```javascript
// User says "update the README too"
pipeline.tasks.push(
  { id: "docs", name: "Documentation", status: "pending", dependsOn: ["req"], assignedTo: null, activities: [] }
);
// "docs" can start immediately since "req" is done
```

**Review cycles** — review creates new fix tasks, PR re-points:

```javascript
// Code review found issues
pipeline.tasks.push(
  { id: "fix-1",     name: "Fix: extract to common pkg", status: "pending", dependsOn: ["review"], ... },
  { id: "retest",    name: "Re-test",                    status: "pending", dependsOn: ["fix-1"], ... },
  { id: "re-review", name: "Re-review",                  status: "pending", dependsOn: ["retest"], ... }
);
// Update PR to depend on re-review
pipeline.tasks.find(t => t.id === "pr").dependsOn = ["re-review"];
```

**Ready tasks** — tasks whose dependencies are all `done`:

```javascript
function getReadyTasks(pipeline) {
  return pipeline.tasks.filter(t =>
    t.status === 'pending' &&
    t.dependsOn.every(depId => pipeline.tasks.find(d => d.id === depId)?.status === 'done')
  );
}
```

**New tools:**

| Tool | Purpose |
|------|---------|
| `create_pipeline` | Create a pipeline with tasks and dependencies |
| `read_pipeline` | Read current pipeline state |
| `add_task` | Add a task with dependencies (for interrupts, review fixes) |
| `update_task_status` | Set a task's status + optional activity |
| `update_task_deps` | Change a task's dependencies (for review cycles) |
| `complete_pipeline` | Mark pipeline done, set completion action cards |

### 1b. Status Emission

Agents emit concise status updates for the activity log via a tool:

```javascript
const emitStatusTool = tool({
  name: 'emit_status',
  description: 'Emit a short status update for the pipeline activity log. Keep under 100 chars.',
  inputSchema: z.object({
    taskId: z.string().describe('Pipeline task this status belongs to'),
    text: z.string(),
    done: z.boolean().optional().describe('If true, marks this as a completion message')
  }),
  callback: async (input) => {
    const pipeline = getActivePipeline();
    const task = pipeline.tasks.find(t => t.id === input.taskId);
    if (!task) return { error: 'Task not found' };

    task.activities.push({
      text: input.text,
      ts: Date.now(),
      done: input.done || false
    });
    savePipelines();
    renderPipelineActivity();
    return { emitted: true };
  }
});
```

Auto-emission hook for tool calls (optional, supplements explicit emit_status):

```javascript
class AutoStatusHook {
  constructor(agentId) { this.agentId = agentId; }

  registerCallbacks(registry) {
    registry.addCallback(BeforeToolCallEvent, (event) => {
      if (event.toolUse.name === 'emit_status') return;
      const task = getActiveTaskForAgent(this.agentId);
      if (!task) return;

      const label = {
        'github_write_file': `Writing ${event.toolUse.input?.path}`,
        'github_create_pr': 'Creating pull request...',
        'delegate_to_agent': `Delegating to ${event.toolUse.input?.role}...`,
      }[event.toolUse.name];

      if (label) {
        task.activities.push({ text: label, ts: Date.now(), done: false });
        renderPipelineActivity();
      }
    });
  }
}
```

---

## Phase 2: Split-Panel Layout + Pipeline Visualization

**Goal:** Restructure agi.html into a two-panel layout with the pipeline
visualization on the right.

### 2a. Layout

```
┌──────────┬────────────────────────────┬──────────────────────────────────┐
│ Sidebar  │      Chat Panel            │      Pipeline Panel              │
│          │                            │                                  │
│ +Create  │  [user message]            │  ○─○─●─○─○─○─○  (phase pills)  │
│ Chats    │  [agent response]          │    ┌─○─○  (sub-pipeline)        │
│ Tasks    │  [user steers]             │                                  │
│          │  [agent acknowledges]      │  Requirements                    │
│ Settings │                            │    Status line...                │
│ Feedback │                            │    Status line ✓                 │
│          │                            │                                  │
│          │                            │  Technical Planning              │
│          │                            │    Status line...                │
│          │                            │                                  │
│          │                            │  Coding                          │
│          │                            │    Status line...                │
│          │                            │                                  │
│          │                            │  ┌──────┐ ┌──────┐ ┌──────┐    │
│          │                            │  │ CTA  │ │ CTA  │ │ CTA  │    │
│          ├────────────────────────────┤  └──────┘ └──────┘ └──────┘    │
│          │ Update task or ask...   [↑]│                                  │
└──────────┴────────────────────────────┴──────────────────────────────────┘
```

**Implementation:**
- CSS grid: `grid-template-columns: 100px 1fr 1fr`
- Pipeline panel collapsible (toggle button) — falls back to full-width chat
- Pipeline panel scrolls independently from chat
- Responsive: on narrow screens, pipeline becomes a bottom drawer

### 2b. Pipeline Pill Component

Renders tasks as pills. Layout follows dependency order (topological sort).
Colors driven entirely by status.

```javascript
function renderPipelinePills(pipeline) {
  const container = document.getElementById('pipelinePills');
  container.innerHTML = '';

  const ordered = topoSort(pipeline.tasks);

  ordered.forEach((task, i) => {
    if (i > 0) {
      const conn = document.createElement('span');
      conn.className = 'phase-connector';
      container.appendChild(conn);
    }

    const pill = document.createElement('span');
    pill.className = `phase-pill phase-${task.status}`;
    pill.textContent = task.name;
    pill.onclick = () => scrollToTaskActivity(task.id);
    container.appendChild(pill);
  });
}
```

**CSS — state drives style, task color drives hue:**

```css
.phase-pill          { padding: 6px 16px; border-radius: 20px; cursor: pointer; font-size: 13px; transition: all 0.3s; }
.phase-pending       { border: 1px dashed #555; color: #888; }
.phase-working       { border: 1px solid var(--task-color); color: var(--task-color); animation: pulse 2s infinite; }
.phase-done          { border: 1px solid #00ff88; color: #00ff88; background: rgba(0,255,136,0.08); }
.phase-error         { border: 1px solid #ff6666; color: #ff6666; }
.phase-connector     { width: 24px; border-top: 1px dashed #444; display: inline-block; vertical-align: middle; }
@keyframes pulse     { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
```

Pills use `style="--task-color: #9966ff"` set from the task's assigned color.
When done, all pills go uniform green regardless of their assigned color.

### 2c. Activity Log Component

```javascript
function renderPipelineActivity() {
  const pipeline = getActivePipeline();
  if (!pipeline) return;

  const log = document.getElementById('activityLog');
  log.innerHTML = '';

  const active = pipeline.tasks
    .filter(t => t.activities.length > 0)
    .sort((a, b) => a.activities[0].ts - b.activities[0].ts);

  active.forEach(task => {
    const heading = document.createElement('div');
    heading.className = 'activity-heading';
    // Heading uses task's own color (green for requirements, purple for planning, etc.)
    heading.style.color = task.status === 'done' ? '#00ff88' : (task.color || '#ccc');
    heading.textContent = task.name;
    log.appendChild(heading);

    task.activities.forEach(a => {
      const line = document.createElement('div');
      line.className = 'activity-line';
      if (a.done) {
        line.style.color = '#00ff88';
        line.textContent = a.text + ' ✓';
      } else {
        line.style.color = '#ccc';
        line.textContent = a.text;
      }
      log.appendChild(line);
    });
  });

  log.scrollTop = log.scrollHeight;
}
```

### 2d. Completion Action Cards

Rendered at the bottom of the activity log when pipeline status is `completed`:

```javascript
function renderCompletionCards(pipeline) {
  if (pipeline.status !== 'completed') return;

  const container = document.getElementById('completionCards');
  container.innerHTML = '';

  pipeline.completionActions.forEach(action => {
    const card = document.createElement('a');
    card.className = 'completion-card';
    card.href = action.url || '#';
    card.target = '_blank';
    card.style.borderColor = action.type === 'github_pr' ? '#00ff88'
      : action.type === 'sandbox' ? '#aa88ff' : '#ffaa00';
    card.innerHTML = `
      <strong>${action.label}</strong>
      <span>${action.description}</span>
      <span class="card-badge">${action.badge || ''}</span>
    `;
    container.appendChild(card);
  });
}
```

---

## Phase 3: Synchronous Delegation + Phase Orchestrator

**Goal:** Let agents delegate to specialists and orchestrate pipeline phases.

### 3a. `delegate_to_agent` Tool

The parent agent's tool call creates a child agent, runs it to completion, and
returns the result. The child agent is given the current pipeline context and
a specific phase to work on.

```javascript
const delegateToAgentTool = tool({
  name: 'delegate_to_agent',
  description: 'Delegate a task to a specialist agent. Blocks until complete. '
    + 'The delegate works on a specific pipeline phase and emits status updates.',
  inputSchema: z.object({
    role: z.string(),
    provider: z.string(),
    systemPrompt: z.string(),
    task: z.string(),
    phaseId: z.string().optional().describe('Pipeline task this delegate works on'),
    tools: z.array(z.string()).optional(),
    maxTokens: z.number().optional()
  }),
  callback: async (input) => {
    const model = createModel(input.provider, { maxTokens: input.maxTokens || 4096 });

    // Build tool set — always include emit_status + task tools
    const toolNames = input.tools || ['storage_get', 'storage_set', 'fetch_url'];
    const toolSet = TOOLS.filter(t => toolNames.includes(t.name));
    toolSet.push(emitStatusTool, readPipelineTool);

    const hook = new StatusEmissionHook(`delegate:${input.role}`);
    const delegate = new Agent({
      model,
      tools: toolSet,
      systemPrompt: input.systemPrompt,
      hooks: [hook],
      printer: false
    });

    // Set task to working
    if (input.phaseId) {
      claimTask(input.phaseId, `delegate:${input.role}`);
    }

    // Inject pipeline context
    const pipelineContext = getPipelineContext();
    const ringContext = getRingContext();

    let result = '';
    for await (const event of delegate.stream(
      `${pipelineContext}\n${ringContext}\n\nTask: ${input.task}`
    )) {
      if (event?.type === 'modelContentBlockDeltaEvent'
          && event.delta?.type === 'textDelta') {
        result += event.delta.text;
      }
    }

    // Add to ring buffer
    state.ringBuffer.push({
      agentId: `delegate:${input.role}`,
      role: 'assistant',
      content: result,
      timestamp: Date.now()
    });

    return { role: input.role, result };
  }
});
```

### 3b. Task Orchestrator

The chat agent's system prompt makes it a pipeline orchestrator. When it
receives a complex task, it creates a pipeline, then delegates each task to
a specialist as dependencies are met.

**Orchestrator system prompt addition:**

```
## Pipeline Orchestration

When you receive a complex development task:

1. Create a pipeline with create_pipeline. Define tasks and their dependencies.
   Tasks with no unmet dependencies can run in parallel automatically.

2. Delegate each ready task to a specialist using delegate_to_agent.
   Each delegate MUST use emit_status to report progress.

3. After each delegation completes, check for newly ready tasks (dependencies
   now met) and delegate those.

4. If Code Review finds issues, use add_task to create fix tasks that depend
   on the review, then re-test and re-review tasks. Update PR dependencies
   with update_task_deps.

5. When the user sends additional requirements mid-task:
   - Acknowledge immediately in chat
   - Use add_task with appropriate dependencies
   - Delegate the new task

6. When all tasks are done, use complete_pipeline with action cards.
```

### 3c. Task Locking

Tasks have an `assignedTo` field. When a delegate starts a task, it's locked:

```javascript
function claimTask(taskId, agentId) {
  const pipeline = getActivePipeline();
  const task = pipeline.tasks.find(t => t.id === taskId);
  if (task.assignedTo && task.assignedTo !== agentId) {
    throw new Error(`Task locked by ${task.assignedTo}`);
  }
  task.status = 'working';
  task.assignedTo = agentId;
  savePipelines();
  renderPipelinePills(pipeline);
}
```

---

## Phase 4: Mid-Execution Interrupts + Dynamic Phases

**Goal:** Let users send messages to agents while they're processing. Interrupts
can spawn new phases or modify the pipeline.

### 4a. MessageQueueHook

```javascript
class MessageQueueHook {
  constructor() {
    this.queue = [];
  }

  enqueue(message) {
    this.queue.push(message);
  }

  registerCallbacks(registry) {
    registry.addCallback(BeforeModelCallEvent, (event) => {
      if (this.queue.length === 0) return;
      const messages = this.queue.splice(0);
      const agent = event.agent;

      for (const msg of messages) {
        agent.messages.push(
          { role: 'user', content: [{ text: `[User update]: ${msg}` }] },
          { role: 'assistant', content: [{ text: 'Acknowledged. Incorporating this.' }] }
        );
      }
    });
  }
}
```

### 4b. Interrupt → Pipeline Modification

When the chat agent receives a user message while a pipeline is running:

1. Chat agent responds immediately (left panel)
2. Chat agent uses `add_task` with appropriate dependencies to add new work
3. New task becomes ready as soon as its dependencies are met
4. Chat agent delegates the new task

```
When the user sends a message while a pipeline is running:
- If it's a new requirement: add_task with dependencies, then delegate
- If it modifies an active task: inject into the running delegate's queue
- If it's a question: answer directly from pipeline state
- Always acknowledge immediately
```

### 4c. UI for Interrupts

- The input bar is always active during pipeline execution
- A subtle indicator shows "Pipeline running — your message will be incorporated"
- When a message is injected, a brief flash on the affected phase pill

---

## Phase 5: Conversation Summarization

**Goal:** Prevent context window overflow for long-running pipeline orchestration.

```javascript
class SummarizingConversationManager {
  constructor({ maxMessages = 40, keepRecent = 10 } = {}) {
    this.maxMessages = maxMessages;
    this.keepRecent = keepRecent;
  }

  registerCallbacks(registry) {
    registry.addCallback(AfterInvocationEvent, (event) => {
      const messages = event.agent.messages;
      if (messages.length <= this.maxMessages) return;

      // Extract key content from old messages
      const old = messages.slice(0, messages.length - this.keepRecent);
      const recent = messages.slice(-this.keepRecent);
      const summary = old
        .filter(m => m.content?.[0]?.text)
        .map(m => `[${m.role}]: ${m.content[0].text.slice(0, 200)}`)
        .join('\n');

      messages.length = 0;
      messages.push(
        { role: 'user', content: [{ text: `[Conversation summary]\n${summary}` }] },
        { role: 'assistant', content: [{ text: 'Context loaded. Continuing.' }] },
        ...recent
      );
    });

    registry.addCallback(AfterModelCallEvent, (event) => {
      if (event.error?.name === 'ContextWindowOverflowError') {
        const messages = event.agent.messages;
        const keep = messages.slice(-this.keepRecent);
        messages.length = 0;
        messages.push(...keep);
        event.retryModelCall = true;
      }
    });
  }
}
```

Applied to both the chat agent and all delegates.

---

## Phase 6: GitHub Integration

**Goal:** Agents can read/write code, create PRs, and link to them in
completion cards.

### 6a. GitHub Device Flow OAuth

No server needed — uses GitHub's device authorization grant:

```javascript
async function githubDeviceAuth(clientId) {
  // 1. Request device code
  const codeRes = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&scope=repo`
  }).then(r => r.json());

  // 2. Show user the code and URL
  showGitHubAuthModal(codeRes.user_code, codeRes.verification_uri);

  // 3. Poll for token
  return new Promise((resolve) => {
    const poll = setInterval(async () => {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${clientId}&device_code=${codeRes.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
      }).then(r => r.json());

      if (tokenRes.access_token) {
        clearInterval(poll);
        state.credentials.github = { token: tokenRes.access_token };
        saveState();
        resolve(tokenRes.access_token);
      }
    }, codeRes.interval * 1000);
  });
}
```

### 6b. GitHub Tools

| Tool | Purpose |
|------|---------|
| `github_list_repos` | List user's repositories |
| `github_read_file` | Read file content from a repo |
| `github_write_file` | Create/update a file with commit message |
| `github_create_branch` | Create a branch from a ref |
| `github_create_pr` | Create a pull request (returns URL for completion card) |
| `github_list_issues` | List issues for a repo |
| `github_create_issue` | Create an issue |

All tools call `https://api.github.com/` with the stored token and include
standard headers (`Authorization: Bearer`, `Accept: application/vnd.github+json`).

### 6c. Repo Selector

A dropdown at the top of the chat panel (matching the reference design) that
sets the active repo context. Stored in pipeline metadata.

---

## Phase 7: Sandbox Tool

**Goal:** Agents write HTML/JS/CSS to localStorage, render in sandboxed iframes.

### 7a. Sandbox Store

```javascript
// localStorage key: 'agi_sandboxes'
{
  "sandbox-xxxx": {
    id: "sandbox-xxxx",
    name: "Log Formatter Preview",
    html: "...",
    css: "...",
    js: "...",
    createdBy: "coder",
    lastModified: 1707200000000
  }
}
```

### 7b. Sandbox Tools

| Tool | Purpose |
|------|---------|
| `sandbox_create` | Create a new sandbox with HTML/CSS/JS |
| `sandbox_update` | Update an existing sandbox |
| `sandbox_read` | Read a sandbox's current code |
| `sandbox_list` | List all sandboxes |
| `sandbox_delete` | Delete a sandbox |

### 7c. Sandboxed Rendering

```javascript
function renderSandbox(sandbox) {
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-scripts';  // JS runs, but no parent access
  iframe.style.cssText = 'width:100%;height:400px;border:1px solid #333;border-radius:8px;';
  iframe.srcdoc = `<!DOCTYPE html>
<html><head><style>${sandbox.css || ''}</style></head>
<body>${sandbox.html || ''}
<script>${sandbox.js || ''}<\/script>
</body></html>`;
  return iframe;
}
```

- `sandbox="allow-scripts"` — JS executes but can't access parent page
- No `allow-same-origin` — prevents localStorage/cookie access
- `srcdoc` — inline content, no network request
- Sandboxes can be linked as completion action cards ("Preview" button)

---

## Phase 8: Per-Agent Tool Restriction

**Goal:** Different agents get different tool sets for safety.

### 8a. Tool Groups

```javascript
const TOOL_GROUPS = {
  core: [renderUiTool, javascriptEvalTool, storageGetTool, storageSetTool, fetchUrlTool, notifyTool],
  pipeline: [createPipelineTool, readPipelineTool, addTaskTool, updateTaskStatusTool, updateTaskDepsTool, completePipelineTool, emitStatusTool],
  delegation: [delegateToAgentTool, useAgentTool, schedulerTool],
  mesh: [invokeAgentTool, broadcastToAgentsTool, listAgentsTool, invokeRemoteAgentTool, subscribeTopicTool, publishTopicTool],
  github: [githubListReposTool, githubReadFileTool, githubWriteFileTool, githubCreateBranchTool, githubCreatePrTool, githubListIssuesTool, githubCreateIssueTool],
  sandbox: [sandboxCreateTool, sandboxUpdateTool, sandboxReadTool, sandboxListTool, sandboxDeleteTool]
};
```

### 8b. Spawn Modal

Multi-select checkboxes for tool groups. Defaults vary by role:

| Role | Default Tools |
|------|--------------|
| Chat/Orchestrator | core + pipeline + delegation + mesh |
| Planner | pipeline + emit_status (no shell, no code execution) |
| Coder | core + github + sandbox + emit_status |
| Reviewer | github (read only) + pipeline + emit_status |
| Tester | sandbox + core + emit_status |

Delegates created via `delegate_to_agent` get their tools from the tool call
input, so the orchestrator controls what each specialist can do.

---

## Dependency Graph

```
Phase 1 (Pipeline Model + Status) ─┬── Phase 2 (Layout + Viz)
                                    ├── Phase 3 (Delegation + Orchestrator)
                                    └── Phase 4 (Interrupts)

Phase 2 (Layout + Viz) ◄── Phase 1

Phase 3 (Delegation) ◄── Phase 1

Phase 4 (Interrupts) ◄── Phase 3

Phase 5 (Summarization) ◄── standalone

Phase 6 (GitHub) ◄── standalone
Phase 7 (Sandbox) ◄── standalone
Phase 8 (Tool Restriction) ◄── Phase 3

Phase 2 completion cards ◄── Phase 6 + Phase 7
```

**Build order:**

1. **Phase 1** — Pipeline data model + emit_status tool (everything depends on this)
2. **Phase 2** — Split-panel layout + pipeline pills + activity log (see it working)
3. **Phase 7** — Sandbox tool (quick win, standalone, useful for testing viz)
4. **Phase 3** — Delegation + orchestrator (agents can now drive the pipeline)
5. **Phase 8** — Tool restriction (safety before going further)
6. **Phase 4** — Interrupts (user steering)
7. **Phase 5** — Summarization (long-running support)
8. **Phase 6** — GitHub integration (needs OAuth app, do last)
9. **Polish** — Completion cards, sub-pipeline rendering, animations

## Estimated Scope

| Phase | New Tools | New Hooks | Lines (est.) |
|-------|-----------|-----------|-------------|
| 1 Pipeline + Status | 7 | 1 | ~250 |
| 2 Layout + Viz | 0 | 0 | ~400 (HTML/CSS/JS) |
| 3 Delegation + Orchestrator | 1 | 0 | ~120 |
| 4 Interrupts | 0 | 1 | ~80 |
| 5 Summarization | 0 | 1 | ~60 |
| 6 GitHub | 7 | 0 | ~300 |
| 7 Sandbox | 5 | 0 | ~120 |
| 8 Tool Restriction | 0 | 0 | ~60 |
| **Total** | **20** | **3** | **~1390** |
