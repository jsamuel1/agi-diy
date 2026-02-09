# Multi-Agent Browser AGI Architecture

## Overview

agi.diy is a fully browser-based autonomous AI agent system built on the
[Strands Agents SDK](https://github.com/strands-agents/sdk-typescript). The
multi-agent system (`agi.html`) extends the single-agent interface (`index.html`)
with concurrent agent execution, shared context, and distributed mesh networking
across devices.

### What It Solves

The single-agent version runs one agent on the main thread with no way to
coordinate multiple specialists or share context between tasks. The multi-agent
system adds:

- **Concurrent agents** — spawn multiple agents with different models, prompts,
  and tool sets, all running in the same browser tab
- **Shared context (ring buffer)** — agents see a rolling window of each other's
  recent activity, enabling collaboration without explicit handoffs
- **Agent-to-agent communication** — direct invocation, broadcast, and pub/sub
  messaging between agents
- **Cross-device mesh** — a hybrid local + remote networking layer lets agents on
  different machines collaborate through a lightweight WebSocket relay

### Current Implementation

The active multi-agent system lives in `agi.html` and runs entirely on the main
thread using the Strands SDK. A separate worker-based architecture exists in
`lib/agi-core.js` and `workers/` but is not currently integrated (see
[Future: Worker-Based Architecture](#future-worker-based-architecture)).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       BROWSER INSTANCE (agi.html)                       │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  state                                                            │  │
│  │  ├── agents: Map<id, { agent, model, messages, systemPrompt }>   │  │
│  │  ├── ringBuffer: [ { agentId, role, content, timestamp } ... ]   │  │
│  │  ├── credentials: { anthropic, openai, bedrock }                 │  │
│  │  └── schedules: Map<name, { interval, agentId, prompt }>        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                    │
│  │   Agent A    │  │   Agent B    │  │   Agent N    │                    │
│  │  (Strands)   │  │  (Strands)   │  │  (Strands)   │                    │
│  │  Anthropic   │  │   OpenAI     │  │   Bedrock    │                    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                    │
│         │                 │                 │                            │
│         └─────────────────┼─────────────────┘                            │
│                           ▼                                              │
│              ┌─────────────────────────┐                                │
│              │       agentMesh         │                                │
│              │  ┌───────────────────┐  │                                │
│              │  │ BroadcastChannel  │──┼──── Same-origin tabs           │
│              │  │  ('agi-mesh')     │  │                                │
│              │  └───────────────────┘  │                                │
│              │  ┌───────────────────┐  │                                │
│              │  │    WebSocket      │──┼──── Remote instances           │
│              │  │  (relay client)   │  │                                │
│              │  └───────────────────┘  │                                │
│              └─────────────────────────┘                                │
│                           │                                              │
│                    localStorage                                          │
│                  (state persistence)                                     │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │     relay-server.js        │
              │   (Node.js WebSocket)      │
              │   ws://host:8765           │
              └─────────────┬──────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   Other Browser Instances  │
              │   (same architecture)      │
              └───────────────────────────┘
```

### Data Flow

1. User sends a message to an agent via the chat UI
2. The agent processes it through the Strands SDK (`Agent.stream()`)
3. Tool calls execute on the main thread (DOM access, fetch, localStorage)
4. The agent's response is appended to the shared ring buffer
5. Other agents see this context on their next invocation
6. If mesh networking is active, messages route to local tabs via
   BroadcastChannel and to remote instances via the WebSocket relay

## Core Runtime

All agents run on the main thread. Each agent is a Strands SDK `Agent` instance
with its own model provider, system prompt, and shared tool set.

### Global State

```javascript
const state = {
  agents: new Map(),      // agentId → { agent, model, config, messages, status, color }
  activeAgentId: null,    // Currently selected in UI
  ringBuffer: [],         // Shared context across all agents
  schedules: new Map(),   // Scheduled/recurring tasks
  credentials: {          // API keys per provider
    anthropic: { apiKey, model },
    openai:    { apiKey, model },
    bedrock:   { apiKey, region, model }
  }
};
```

### Model Providers

Three providers, each implementing `async *stream(messages, options)`:

| Provider | Class | Default Model | Auth |
|----------|-------|---------------|------|
| Anthropic | `AnthropicModel` | `claude-sonnet-4-20250514` | API key |
| OpenAI | `OpenAIModel` | `gpt-4o` | API key |
| Bedrock | `BedrockModel` | `anthropic.claude-3-sonnet-20240229-v1:0` | API key + region |

The `createModel(provider, config)` factory instantiates the correct class from
stored credentials.

### Agent Lifecycle

```javascript
// Spawning an agent
const model = createModel('anthropic');
const agent = new Agent({
  model,
  tools: TOOLS,                              // All agents share the same tool set
  systemPrompt: buildSystemPrompt(id, prompt),
  printer: false                             // UI handles rendering
});

state.agents.set(id, { agent, model, config, messages: [], status: 'ready', color });
```

Agents are spawned through the UI or programmatically via the `use_agent` tool.
Each agent gets a system prompt that includes its ID, available capabilities, and
the current ring buffer context (last 10 messages from other agents).

### Ring Buffer (Shared Context)

The ring buffer is a plain array on `state.ringBuffer`. After each agent turn,
the response is appended:

```javascript
state.ringBuffer.push({ agentId, role, content, timestamp });
```

When building an agent's system prompt, `getRingContext()` injects the last 10
entries so agents are aware of each other's recent activity. This is the "ring
attention" mechanism — lightweight, no shared memory, just prompt injection.

## Agent Mesh Network

The `agentMesh` object provides a hybrid communication layer that works both
locally (same-origin browser tabs) and remotely (across devices via a WebSocket
relay server).

### Two Transport Channels

| Channel | Technology | Scope | Latency |
|---------|-----------|-------|---------|
| Local | `BroadcastChannel('agi-mesh')` | Same-origin tabs | Sub-millisecond |
| Remote | WebSocket to relay server | Cross-device | Network-dependent |

Messages are published to both channels simultaneously via `agentMesh.publish()`.
The local channel is always active; the remote channel connects on demand.

### Instance Identity

Each browser instance gets a persistent ID stored in localStorage:

```javascript
instanceId: localStorage.getItem('mesh_instance_id')
  || `agi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
```

This ID distinguishes messages from different browser instances and prevents
echo (processing your own broadcasts).

### Message Protocol

All mesh messages share this shape:

```javascript
{ type, from, to, turnId, data, timestamp }
```

Message types:

| Type | Purpose |
|------|---------|
| `presence` | Announce instance + agent list on connect |
| `heartbeat` | Keep-alive with agent list (every 10s) |
| `broadcast` | Send command to all agents |
| `direct` | Send command to a specific agent |
| `stream` | Streaming response chunk |
| `ack` | Acknowledgment that processing started |
| `turn_end` | Agent finished processing |
| `error` | Error during processing |
| `topic` | Pub/sub topic message |

### Peer Discovery

Remote peers are tracked in `agentMesh.remotePeers` (a Map of instanceId →
metadata). Peers are discovered via `presence` messages on connect and maintained
via `heartbeat` messages. Peers with no heartbeat for 30 seconds are pruned.

### Request/Response Flow

When an agent invokes another agent through the mesh:

1. Caller publishes a `direct` or `broadcast` message with a unique `turnId`
2. A pending request is stored in `agentMesh.pendingRequests` with a Promise
3. Target agent(s) send `ack`, then `stream` chunks, then `turn_end`
4. The Promise resolves when all expected responses arrive or timeout hits
5. Caller receives aggregated results

This gives agents an async/await interface for cross-agent communication:

```javascript
const result = await agentMesh.sendTo('agent-a', 'agent-b', 'summarize the data');
```

## Relay Server

`relay-server.js` is a minimal Node.js WebSocket server that enables cross-device
mesh networking. It does one thing: relay messages from each connected client to
all other connected clients.

### Running

```bash
node relay-server.js [port]   # default: 8765
```

Then in agi.html: Settings → Network → enter `ws://hostname:8765` → Connect.

### How It Works

```
Client A ──┐                    ┌── Client B
            ├── relay-server ──┤
Client C ──┘    (broadcast)     └── Client D
```

- Clients connect via WebSocket
- Any message from one client is forwarded to all other clients
- The server tracks instance IDs, agent lists, and last-seen timestamps
- No message filtering or routing — it's a dumb pipe
- Status logged to console every 30 seconds

### Limitations

This is a development relay, not a production service:

- **No authentication** — any WebSocket client can connect
- **No TLS** — uses `ws://`, not `wss://`
- **Listens on 0.0.0.0** — exposed to the network, not just localhost
- **No rate limiting** — vulnerable to message flooding
- **Broadcast only** — no server-side routing; all clients see all messages
- **No persistence** — messages are not stored; offline clients miss everything

For production use, you'd want TLS termination, authentication tokens, message
routing by instance/agent ID, and rate limiting at minimum.

## Tool System

All agents share the same tool set, defined using the Strands SDK `tool()`
helper with Zod schemas for input validation. Tools are grouped into three
categories:

### Core Tools

| Tool | Purpose |
|------|---------|
| `render_ui` | Render HTML/CSS/JS components inline in chat |
| `javascript_eval` | Execute arbitrary JavaScript in the browser |
| `storage_get` | Read from localStorage |
| `storage_set` | Write to localStorage |
| `fetch_url` | Make HTTP requests (method, headers, body) |
| `notify` | Send browser push notifications |

### Agent Management Tools

| Tool | Purpose |
|------|---------|
| `use_agent` | Spawn a sub-agent with a specific provider/prompt for a one-off task |
| `scheduler` | Create, list, or delete scheduled/recurring tasks (once or cron) |

### Mesh Communication Tools

| Tool | Purpose |
|------|---------|
| `invoke_agent` | Send a message to a specific agent, wait for streamed response |
| `broadcast_to_agents` | Send a message to all agents, collect responses |
| `list_agents` | List all local and remote agents with status |
| `invoke_remote_agent` | Target a specific agent on a specific remote instance |
| `subscribe_topic` | Subscribe to a pub/sub topic with a JS handler |
| `publish_topic` | Publish a message to a topic (local + remote) |

### Tool Execution

Tools run on the main thread, which means they have full DOM access. This is
important for `render_ui` and `javascript_eval` — they wouldn't work in a Web
Worker without proxying. The tradeoff is that a long-running tool blocks other
agents until it completes.

## State & Persistence

All state is persisted to `localStorage` under the key `agi_multi_state`.

### What's Saved

```javascript
{
  credentials: { anthropic, openai, bedrock },  // API keys + model defaults
  agents: [                                      // Last 50 messages per agent
    { id, config: { provider, modelId, systemPrompt, maxTokens }, messages, color }
  ],
  ringBuffer: [ /* last 50 entries */ ]
}
```

### Save/Load Cycle

- `saveState()` is called after agent spawn, message completion, and settings
  changes. It serializes credentials, agent configs (not the `Agent` instance
  itself), recent messages, and the ring buffer tail.
- `loadState()` runs on page load. It recreates `Agent` instances from saved
  configs using `createModel()` and `new Agent()`, restoring the full runtime.
- Mesh state (`instanceId`, `relay_url`) is stored in separate localStorage keys.

### Limitations

- **localStorage has a ~5-10 MB limit** per origin. With 50 messages per agent
  and multiple agents, this can fill up. There's no eviction or warning.
- **API keys are stored in plaintext** in localStorage. The original architecture
  proposed WebAuthn-based encryption, but this is not implemented.
- **No IndexedDB** — the worker-based system in `lib/agi-core.js` has a full
  IndexedDB schema, but `agi.html` doesn't use it.
- **Message history is truncated** — only the last 50 messages per agent survive
  a page reload. Older context is lost.

## Security Considerations

### Current State

The system is designed for local/trusted use. Several areas need hardening
before any shared or public deployment:

| Area | Current | Risk |
|------|---------|------|
| API key storage | Plaintext in localStorage | Any XSS or extension can read keys |
| Relay server | No auth, no TLS, binds 0.0.0.0 | Anyone on the network can connect and see all messages |
| `javascript_eval` tool | Executes arbitrary JS | Agents can access/modify anything in the page |
| Cross-agent isolation | None — shared tools, shared state | One agent can interfere with another's data |
| Mesh messages | No signing or encryption | Messages can be spoofed by any connected client |
| CORS | API calls made directly from browser | API keys visible in network inspector |

### Recommendations for Hardening

1. **Credential encryption** — implement the WebAuthn-based `EncryptedStore`
   from `lib/agi-core.js`, or at minimum use the existing AES-256-GCM encryption
   from `index.html`'s settings sync feature
2. **Relay authentication** — add token-based auth to the WebSocket relay so
   only authorized instances can connect
3. **TLS for relay** — use `wss://` with a reverse proxy or built-in TLS
4. **Tool sandboxing** — scope `javascript_eval` per agent, or run it in an
   iframe sandbox to limit blast radius
5. **Message signing** — sign mesh messages with a shared secret or per-instance
   key to prevent spoofing
6. **Rate limiting** — add per-client rate limits on the relay server

## Future: Worker-Based Architecture

A worker-based multi-agent system previously existed in `lib/agi-core.js`,
`workers/agent-worker.js`, and `workers/bus-worker.js`. These files have been
removed from the repository as the main-thread approach in `agi.html` proved
sufficient and simpler to maintain.

The worker architecture included:

- **True concurrency** — each agent in its own Web Worker thread
- **IndexedDB persistence** — structured storage with 6 object stores
- **WebAuthn credential encryption** — biometric-gated API key storage
- **SharedWorker message bus** — centralized inter-agent communication

### Why It Was Removed

The main blocker was tool execution. Tools like `render_ui` and `javascript_eval`
need DOM access, which Web Workers don't have. Proxying tool calls back to the
main thread via `postMessage` added complexity without clear benefit given the
current usage patterns.

### If Revisited

If main-thread blocking becomes a problem with many concurrent agents:

1. Move model calls to workers (biggest win — unblocks the main thread)
2. Proxy DOM-dependent tools back to main thread via `postMessage`
3. Replace localStorage with IndexedDB
4. Integrate a SharedWorker bus with the existing `agentMesh`

## File Reference

```
docs/
├── agi.html                  # Multi-agent interface (active)
├── index.html                # Single-agent interface
├── strands.js                # Strands Agents SDK (bundled)
├── relay-server.js           # WebSocket relay for cross-device mesh
├── context-injector.js       # Activity/context tracking
├── vision.js                 # Screen capture, image upload, ambient mode
├── map.js                    # Google Maps integration
├── webllm.js                 # Local model inference via WebGPU
├── sw.js                     # Service worker (PWA caching)
├── manifest.json             # PWA manifest
└── tools/
    └── google.js             # Google OAuth + 200+ API tools
```
