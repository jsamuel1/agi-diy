# Fork Plan — Loom

Starting fresh. Decomposing the `sauhsoj-ii.html` monolith (~5,650 lines: 975 CSS, 530 HTML, 4,150 JS) into a modular project called **Loom**.

---

## Project Structure

```
loom/
├── index.html                  # Shell — loads CSS + mounts app
├── package.json                # Dev deps (esbuild only)
├── build.mjs                   # Strands SDK browser bundle (from build-strands.mjs)
├── IMPROVEMENTS.md
├── README.md
│
├── src/
│   ├── app.js                  # Entry point — imports everything, runs init()
│   │
│   ├── state/
│   │   ├── store.js            # App state (agents Map, credentials, ring buffer)
│   │   ├── idb.js              # IndexedDB wrapper (agents, pipelines, tools, messages)
│   │   └── migration.js        # One-time localStorage → IndexedDB migration
│   │
│   ├── models/
│   │   └── providers.js        # createModel() — Anthropic, OpenAI, Bedrock, WebLLM, compat
│   │
│   ├── agent/
│   │   ├── lifecycle.js         # spawnAgent, killAgent, selectAgent — keeps instances alive
│   │   ├── messaging.js         # runAgentMessage, sendMessage, broadcastMessage
│   │   ├── transcript.js        # Structured transcript helpers + history reconstruction
│   │   ├── hooks.js             # InterruptHook, SummarizingManager
│   │   └── retry.js             # Retryable stream wrapper with exponential backoff
│   │
│   ├── tools/
│   │   ├── core.js              # render_ui, javascript_eval, storage, fetch_url, notify
│   │   ├── self-mod.js          # create_tool, update_self, list_tools, delete_tool
│   │   ├── mesh.js              # invoke_agent, broadcast_to_agents, list_agents
│   │   ├── pipeline.js          # create_pipeline, add_task, update_task_status
│   │   ├── sandbox.js           # sandbox_create, sandbox_update, preview mode
│   │   ├── github.js            # github_search, github_read_file, github_create_pr, etc.
│   │   ├── cross-tab.js         # invoke_mesh_agent, list_mesh_peers, broadcast_mesh
│   │   └── registry.js          # TOOLS array assembly, custom tool builder (sandboxed)
│   │
│   ├── mesh/
│   │   ├── local.js             # BroadcastChannel P2P
│   │   ├── remote.js            # WebSocket relay connection
│   │   └── ring.js              # Ring buffer with relevance filtering
│   │
│   ├── ui/
│   │   ├── messages.js          # addMessageToUI, streaming, tool call rendering
│   │   ├── agents.js            # Agent list, cards, status indicators
│   │   ├── activity.js          # Activity feed, filtering
│   │   ├── pipeline.js          # Pipeline pills, flow visualization
│   │   ├── modals.js            # Spawn, edit, settings modals
│   │   ├── toast.js             # Toast notifications
│   │   └── voice.js             # Voice UI (opt-in, graceful degradation)
│   │
│   ├── sync/
│   │   ├── encrypted.js         # AES-256-GCM export/import via URL
│   │   ├── persistence.js       # saveState/loadState (backed by idb.js)
│   │   └── export.js            # Per-agent + bulk export/import (JSON, Markdown)
│   │
│   └── vendor/
│       └── strands.js           # Built SDK bundle (output of build.mjs)
│
├── styles/
│   ├── base.css                 # Reset, variables, typography, scrollbars
│   ├── layout.css               # App shell, sidebar, content area, panels
│   ├── components.css           # Agent cards, tool blocks, messages, modals
│   └── voice.css                # Voice UI styles
│
├── stubs/                       # Node.js shims for browser SDK bundle (copied from original)
│   ├── ajv.js
│   ├── aws-sdk.js
│   ├── bedrock-runtime.js
│   ├── empty.js
│   ├── events.js
│   ├── mcp-types.js
│   ├── openai-resource.js
│   ├── zod/
│   │   ├── index.js
│   │   ├── v3.js
│   │   ├── v4.js
│   │   └── v4-mini.js
│   └── zod-to-json-schema.js
│
└── public/                      # Static assets
    ├── icon-192.svg
    ├── icon-512.svg
    ├── manifest.json
    └── sw.js
```

---

## Design Decisions

**No build step for the app itself.** The only build is `build.mjs` which bundles the Strands SDK for the browser (same as the original). App code uses native ES modules with `<script type="module">`. This keeps the "view source and understand it" philosophy from the original project.

**No framework.** Vanilla JS, DOM manipulation, ES modules. The original project is intentionally minimal and we keep that.

**CSS is separate files, not a build.** Four CSS files loaded via `<link>` tags. No preprocessor. The original had 975 lines of inline CSS — splitting by concern (base, layout, components, voice) makes it navigable.

**IndexedDB for large data, localStorage for small config.** Credentials and preferences stay in localStorage (sync access, small). Agent messages, pipelines, custom tools go to IndexedDB (async, unlimited).

**Modules map 1:1 to the original section TOC.** If you know the original codebase, you know where to find things. The section headings from `sauhsoj-ii.html` become file names.

---

## Phase 0: Scaffold + Decompose

**Goal:** Working app with identical functionality, but modular structure.

This is purely a refactor — no new features, no bug fixes. The app should behave identically to `sauhsoj-ii.html` when done.

1. Create the repo and directory structure
2. Extract CSS into `styles/*.css`
3. Extract HTML into `index.html` (just the shell + modals)
4. Decompose the `<script>` block into `src/` modules following the section TOC:
   - STATE → `src/state/store.js`
   - MODEL PROVIDERS → `src/models/providers.js`
   - TOOLS → `src/tools/core.js`, `src/tools/self-mod.js`
   - AGENT MESH → `src/mesh/local.js`, `src/mesh/remote.js`
   - MESH TOOLS → `src/tools/mesh.js`
   - SELF-MODIFICATION → `src/tools/self-mod.js`
   - PIPELINE TOOLS → `src/tools/pipeline.js`
   - SANDBOX TOOLS → `src/tools/sandbox.js`
   - HOOKS → `src/agent/hooks.js`
   - GITHUB → `src/tools/github.js`
   - AGENT MANAGEMENT → `src/agent/lifecycle.js`
   - MESSAGING → `src/agent/messaging.js`
   - TRANSCRIPT → `src/agent/transcript.js`
   - ACTIVITY FEED → `src/ui/activity.js`
   - UI RENDERING → `src/ui/messages.js`
   - MODALS → `src/ui/modals.js`
   - SYNC → `src/sync/encrypted.js`
   - PERSISTENCE → `src/sync/persistence.js`
   - CUSTOM TOOLS UI → part of `src/ui/modals.js`
   - VOICE → `src/ui/voice.js`
   - INIT → `src/app.js`
5. Copy `strands.js`, `webllm.js`, `agent-mesh.js`, `context-injector.js` into `src/vendor/`
6. Copy `stubs/` as-is
7. Copy `build-strands.mjs` → `build.mjs` (update output path)
8. Verify the app loads and works

**Validation:** Every feature from `sauhsoj-ii.html` works — spawn agents, send messages, pipeline, GitHub, voice, mesh, settings, export/import.

---

## Phase 1: Storage Foundation

**Goal:** IndexedDB for large data. Fixes IMPROVEMENTS #2 and #9.

1. Implement `src/state/idb.js`:
   - `openDB()` — creates/upgrades the database
   - Object stores: `agents`, `pipelines`, `custom-tools`, `ring-buffer`
   - CRUD helpers: `getAgent(id)`, `putAgent(id, data)`, `getAllAgents()`, etc.
2. Implement `src/state/migration.js`:
   - On first load, detect `agi_multi_state` in localStorage
   - Parse and write to IndexedDB
   - Remove old localStorage keys
3. Update `src/sync/persistence.js` to use IndexedDB
4. Update pipeline tools to use IndexedDB
5. Keep credentials in localStorage (small, sync access needed)

---

## Phase 2: Agent Lifecycle

**Goal:** Agents persist across turns. Fixes IMPROVEMENTS #6, #1, #7.

1. `src/agent/lifecycle.js` — keep live agent instances in state, only recreate on config change
2. `src/agent/hooks.js` — Replace fake `SummarizingManager` with SDK's native `SummarizingConversationManager`; works because agent state now persists
3. `src/agent/messaging.js` — add `finally` block for cleanup on abort/error
4. Remove the fake `SummarizingManager` class entirely — the SDK handles it

---

## Phase 3: History Reconstruction

**Goal:** Agents understand their tool usage history on reload. Fixes IMPROVEMENTS #3.

1. `src/agent/transcript.js` — add `transcriptToMessages()` that maps transcript entries back to proper SDK message blocks
2. Use this in `loadState()` when reconstructing agents from IndexedDB

---

## Phase 4: Resilience

**Goal:** Retry transient errors, smart ring context. Fixes IMPROVEMENTS #4, #5.

1. `src/agent/retry.js` — retryable stream wrapper with exponential backoff
2. `src/mesh/ring.js` — relevance-based filtering for ring context injection

---

## Phase 5: Safety & Export

**Goal:** Safer custom tools, per-agent export. Fixes IMPROVEMENTS #8, #12.

1. `src/tools/registry.js` — wrap custom tool execution in try/catch + timeout
2. `src/sync/export.js` — per-agent JSON/Markdown export with full transcript

---

## Phase 6: Capabilities Port

**Goal:** Vision, ambient mode, context injection from `index.html`. Fixes IMPROVEMENTS #11.

1. Wire up `context-injector.js` (already exists as a module)
2. Wire up `vision.js` (already exists as a module)
3. Add as optional tool groups in spawn modal

---

## Phase 7: Voice Improvements

**Goal:** Voice is opt-in with graceful degradation. Fixes IMPROVEMENTS #10.

1. `src/ui/voice.js` — settings toggle, backoff on reconnect, clear status states
