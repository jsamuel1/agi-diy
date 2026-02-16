# Improvements for agi.diy Fork

Based on analysis of `sauhsoj-ii.html` as the starting point.

---

## 1. SummarizingManager Is Faking It

**Problem:** The current `SummarizingManager` doesn't summarize — it truncates the first half of messages to 2,000 characters and labels it `[CONVERSATION SUMMARY]`. Context is silently lost. Worse, because agents are recreated every message (see #6), the manager's `summaries` Map is always empty, so the summarization logic never actually triggers across turns.

**Fix:** The Strands SDK now exports `SummarizingConversationManager` natively — swap our fake `SummarizingManager` class in `hooks.js` for the real one. It supports configurable `windowSize` and `summaryPrompt`. This also requires fixing #6 first (agent persistence across turns), since the manager's state is lost when agents are recreated every message.

---

## 2. Everything Is in localStorage

**Problem:** All agent state, message history, custom tools, pipeline data, credentials, and ring buffer are serialized into one or two localStorage keys. localStorage has a ~5-10MB limit per origin. With a few agents and long conversations, `saveState()` silently fails when the limit is hit.

**Fix:** Move to IndexedDB for conversation history and agent state. Store conversations per-agent instead of one monolithic blob. Keep only lightweight config (credentials, preferences) in localStorage.

---

## 3. Conversation History Injection Is Naive

**Problem:** When injecting history into a new agent instance, structured transcript data (tool calls, tool results) is flattened to plain text:
```js
const text = msg.content || (msg.transcript ? transcriptFullText(msg.transcript) : '');
```
The agent loses context about what tools it used and what they returned.

**Fix:** Reconstruct proper message blocks from transcript entries — map `tool_use` entries back to tool use blocks and `tool_result` entries back to tool result blocks. This preserves the agent's understanding of its own tool usage history.

---

## 4. No Retry Logic on Model Calls

**Problem:** If the API returns a rate limit (429) or transient error (500/503), the agent fails immediately and shows an error. No retries. This is especially painful during long pipeline runs where one flaky API call kills the whole workflow.

**Fix:** Add exponential backoff with 2-3 retries for retryable HTTP status codes. Surface retry attempts in the activity feed so the user knows what's happening.

---

## 5. Ring Buffer Context Injection Is Unbounded

**Problem:** The ring buffer caps at 100 entries (up to 500 chars each), but the full ring context is injected into every agent's system prompt on every turn. This eats into the context window without regard for relevance.

**Fix:** Relevance-based filtering — only inject ring entries from agents the current agent has interacted with, or entries tagged with topics matching the current task. Allow agents to opt out of ring injection.

---

## 6. Agents Are Recreated From Scratch Every Message

**Problem:** `runAgentMessage` creates a `new Agent({...})` for every single message, then injects history. MCP connections are re-established, tools are re-registered, and conversation manager state (including SummarizingManager) is lost between turns.

**Fix:** Keep agent instances alive across turns. Only recreate when config changes (model, tools, system prompt). Store the live agent instance in `state.agents` and reuse it. This also fixes the SummarizingManager issue (#1) since its state would persist.

---

## 7. No Streaming Cancellation Cleanup

**Problem:** When an agent is aborted via `AbortController`, the streaming loop just `break`s. There's no cleanup of the model connection, no flushing of partial transcript data, and no `finally` block to ensure consistent state.

**Fix:** Add a `finally` block that: saves partial transcript data, updates agent status, cleans up the abort controller, hides the interrupt button, and calls `saveState()`. Ensure partial responses are still visible in the UI.

---

## 8. Custom Tools Are a Code Injection Surface

**Problem:** `buildCustomTools` takes user-defined JavaScript from localStorage and executes it via `new Function()`. No sandboxing. A malicious or buggy custom tool can access the full page context, steal API keys from `state.credentials`, or break the app.

**Fix:** Run custom tool code in a Web Worker with a message-passing interface, or at minimum wrap execution in try/catch with a timeout. Consider a capability-based permission model where custom tools declare what APIs they need access to.

---

## 9. Pipeline State Can Desync From Agent State

**Problem:** Pipelines are stored in a separate `agi_pipelines` localStorage key. If an agent updates a task status but `saveState()` fails (localStorage full), the pipeline shows "done" but the agent's conversation doesn't reflect it.

**Fix:** Either unify pipeline state into the same storage transaction as agent state, or add consistency checks on load that reconcile pipeline status with agent message history.

---

## 10. Voice Is Tightly Coupled to a Local Server

**Problem:** The voice system requires `DevDuck` on `ws://localhost:10001`. If it's not running, the UI shows a disabled mic button and silently retries every 5 seconds forever with no backoff.

**Fix:** Make voice opt-in via settings. Show a clear "voice server not detected" state. Add exponential backoff to the reconnect loop. Consider supporting browser-native Web Speech API as a fallback.

---

## 11. Missing Capabilities From index.html

**Problem:** `sauhsoj-ii.html` lacks vision/screen capture, ambient mode, maps, Google APIs, Bluetooth, and context injection — all present in `index.html`.

**Fix:** Port `ContextInjector` and `VisionAgent` from `index.html`. Ambient mode (agent thinks while you're idle) is especially valuable for multi-agent — background agents could continue research or monitoring tasks. Maps and Google APIs can be added as optional tool modules.

---

## 12. No Per-Agent Conversation Export

**Problem:** There's a bulk `exportAllAgents` that dumps everything, but no way to export a single agent's conversation with its structured transcript intact.

**Fix:** Add per-agent export that preserves the full transcript structure (text blocks, tool use, tool results). Support JSON and Markdown export formats. This also enables conversation replay and analysis.
