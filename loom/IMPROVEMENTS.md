# Improvements for agi.diy Fork

Based on analysis of `sauhsoj-ii.html` as the starting point.

---

## 1. ~~SummarizingManager Is Faking It~~ ✅ DONE

**Problem:** The current `SummarizingManager` doesn't summarize — it truncates the first half of messages to 2,000 characters and labels it `[CONVERSATION SUMMARY]`. Context is silently lost. Worse, because agents are recreated every message (see #6), the manager's `summaries` Map is always empty, so the summarization logic never actually triggers across turns.

**Fix:** The Strands SDK now exports `SummarizingConversationManager` natively — swap our fake `SummarizingManager` class in `hooks.js` for the real one. It supports configurable `windowSize` and `summaryPrompt`. This also requires fixing #6 first (agent persistence across turns), since the manager's state is lost when agents are recreated every message.

**Resolution:** Replaced fake `SummarizingManager` with SDK's native `SummarizingConversationManager` (summaryRatio: 0.3, preserveRecentMessages: 10) in all agent creation paths: `ensureAgent()`, `spawnAgent()`, `saveAgentEdit()`, `autoCreateDefaultAgent()`. Old class in `hooks.js` marked deprecated. Fixed as part of #6.

---

## 2. ~~Everything Is in localStorage~~ ✅ DONE

**Problem:** All agent state, message history, custom tools, pipeline data, credentials, and ring buffer are serialized into one or two localStorage keys. localStorage has a ~5-10MB limit per origin. With a few agents and long conversations, `saveState()` silently fails when the limit is hit.

**Fix:** Move to IndexedDB for conversation history and agent state. Store conversations per-agent instead of one monolithic blob. Keep only lightweight config (credentials, preferences) in localStorage.

**Resolution:** Created `sync/db.js` — IndexedDB wrapper with two object stores: `agents` (per-agent records) and `meta` (key-value for ring buffer, pipelines, sandboxes, custom tools). `saveState()` writes credentials to localStorage (cross-tab sync) and flushes everything else to IDB with coalescing (one in-flight write, last-wins queuing). Transparent migration from old `agi_multi_state` localStorage format on first load. No more 50-message truncation. Pipelines, sandboxes, and custom tools also migrated with in-memory caches and async write-through.

---

## 3. ~~Conversation History Injection Is Naive~~ ✅ DONE

**Problem:** When injecting history into a new agent instance, structured transcript data (tool calls, tool results) is flattened to plain text. With #6 (agent persistence), history injection was removed entirely — agents lost all context after page reload.

**Fix:** Reconstruct proper message blocks from transcript entries — map `tool_use` entries back to tool use blocks and `tool_result` entries back to tool result blocks. This preserves the agent's understanding of its own tool usage history.

**Resolution:** Added `rebuildSDKMessages()` in `transcript.js` — walks stored messages and reconstructs SDK-format messages with proper `textBlock`, `toolUseBlock`, and `toolResultBlock` content types. Groups transcript entries into alternating assistant/user messages matching the SDK's model-turn structure. Called from `ensureAgent()` in `lifecycle.js` whenever a new agent instance is created, injecting the full structured history into `agent.messages`.

---

## 4. ~~No Retry Logic on Model Calls~~ ✅ DONE

**Problem:** If the API returns a rate limit (429) or transient error (500/503), the agent fails immediately and shows an error. No retries. This is especially painful during long pipeline runs where one flaky API call kills the whole workflow.

**Fix:** Add exponential backoff with 2-3 retries for retryable HTTP status codes. Surface retry attempts in the activity feed so the user knows what's happening.

**Resolution:** Added `RetryHook` in `hooks.js` — uses the SDK's native `AfterModelCallEvent.retry` mechanism. Detects retryable errors by error class name (`ModelThrottledError`, `RateLimitError`, `APIConnectionError`, `InternalServerError`), HTTP status code (429, 5xx), and message pattern matching. Exponential backoff with jitter (1s, 2s, 4s base + 0-500ms random). Max 3 retries. Surfaces each retry in both the chat and activity feed.

---

## 5. ~~Ring Buffer Context Injection Is Unbounded~~ ✅ DONE

**Problem:** The ring buffer caps at 100 entries (up to 500 chars each), but the full ring context is injected into every agent's system prompt on every turn. This eats into the context window without regard for relevance.

**Fix:** Relevance-based filtering — only inject ring entries from agents the current agent has interacted with, or entries tagged with topics matching the current task. Allow agents to opt out of ring injection.

**Resolution:** `getRingContext(agentId)` now filters out self-messages, scores entries by recency + pipeline-peer bonus (agents sharing the active pipeline get priority), and selects the top 10. Agents can opt out via `config.ringInjection: false`.

---

## 6. ~~Agents Are Recreated From Scratch Every Message~~ ✅ DONE

**Problem:** `runAgentMessage` creates a `new Agent({...})` for every single message, then injects history. MCP connections are re-established, tools are re-registered, and conversation manager state (including SummarizingManager) is lost between turns.

**Fix:** Keep agent instances alive across turns. Only recreate when config changes (model, tools, system prompt). Store the live agent instance in `state.agents` and reuse it. This also fixes the SummarizingManager issue (#1) since its state would persist.

**Resolution:** Added `ensureAgent(agentId)` in `lifecycle.js` — reuses the live agent instance if config hasn't changed, detected via `computeConfigHash()` (djb2 hash of serialized config). `runAgentMessage` now calls `ensureAgent()` instead of inline `new Agent()`. Naive history injection (flattening transcripts to plain text) removed — the SDK's conversation manager owns message history natively. Also stores `_configHash` on agent data at spawn/edit time. `clearChat`/`clearAllChats` now clear the live agent's SDK messages too.

---

## 7. ~~No Streaming Cancellation Cleanup~~ ✅ DONE

**Problem:** When an agent is aborted via `AbortController`, the streaming loop just `break`s. There's no cleanup of the model connection, no flushing of partial transcript data, and no `finally` block to ensure consistent state.

**Fix:** Add a `finally` block that: saves partial transcript data, updates agent status, cleans up the abort controller, hides the interrupt button, and calls `saveState()`. Ensure partial responses are still visible in the UI.

**Resolution:** Added `finally` block to `runAgentMessage` that cleans up abort controller, hides interrupt button, resets status if still processing, and calls `updateAgentUI()` + `saveState()`. Duplicate cleanup removed from success path. Fixed as part of #6.

---

## 8. ~~Custom Tools Are a Code Injection Surface~~ ✅ DONE

**Problem:** `buildCustomTools` takes user-defined JavaScript from localStorage and executes it via `new Function()`. No sandboxing. A malicious or buggy custom tool can access the full page context, steal API keys from `state.credentials`, or break the app.

**Fix:** Run custom tool code in a Web Worker with a message-passing interface, or at minimum wrap execution in try/catch with a timeout. Consider a capability-based permission model where custom tools declare what APIs they need access to.

**Resolution:** Custom tool code now runs in a Web Worker sandbox via `runInSandbox()`. Each tool invocation spawns a short-lived worker from a shared Blob URL, passes `{ code, input }` via `postMessage`, and receives the result. Worker is terminated after completion or a 10-second timeout. The worker has no access to the DOM, app state, API keys, or `localStorage`. Only `fetch`, `crypto`, and other standard Worker APIs are available.

---

## 9. ~~Pipeline State Can Desync From Agent State~~ ✅ DONE

**Problem:** Pipelines are stored in a separate `agi_pipelines` localStorage key. If an agent updates a task status but `saveState()` fails (localStorage full), the pipeline shows "done" but the agent's conversation doesn't reflect it.

**Fix:** Either unify pipeline state into the same storage transaction as agent state, or add consistency checks on load that reconcile pipeline status with agent message history.

**Resolution:** Two-part fix: (1) `_flushToIDB` now writes agents, ring buffer, AND pipeline state in a single IDB transaction via `db.saveAll()`, so they can't desync on write. (2) `reconcilePipelineState()` runs at startup — any pipeline task stuck in "working" whose assigned agent is "ready" (was interrupted) gets reset to "pending" so it can be re-dispatched.

---

## 10. ~~Voice Is Tightly Coupled to a Local Server~~ ✅ DONE

**Problem:** The voice system requires `DevDuck` on `ws://localhost:10001`. If it's not running, the UI shows a disabled mic button and silently retries every 5 seconds forever with no backoff.

**Fix:** Make voice opt-in via settings. Show a clear "voice server not detected" state. Add exponential backoff to the reconnect loop. Consider supporting browser-native Web Speech API as a fallback.

**Resolution:** Voice is now opt-in — no WebSocket connection on first load. Clicking the mic button enables voice and initiates connection (persisted via `voiceCfg.enabled`). New "disconnected" UI state with tooltip. Exponential backoff on reconnect: starts at 2s, doubles up to 60s max, resets on successful connection. Only auto-reconnects if voice was previously enabled.

---

## 11. ~~No Per-Agent Conversation Export~~ ✅ DONE

**Problem:** There's a bulk `exportAllAgents` that dumps everything, but no way to export a single agent's conversation with its structured transcript intact.

**Fix:** Add per-agent export that preserves the full transcript structure (text blocks, tool use, tool results). Support JSON and Markdown export formats. This also enables conversation replay and analysis.

**Resolution:** Added `exportAgent(agentId, format)` in `persistence.js`. JSON format exports full structured data (config, messages with transcripts). Markdown format renders a human-readable document with headers, code blocks for tool I/O, and system prompt. Export button (↓) added to each agent card in the UI. Shared `_download()` helper consolidates file download logic.
