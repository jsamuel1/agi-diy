# 🪡 Loom

Multi-agent AI platform running entirely in the browser. Built on the [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript).

Fork of [agi.diy](https://github.com/joshmu/agi.diy) (`sauhsoj-ii.html`), decomposed from a 5,650-line monolith into ~30 focused ES modules.

## What it does

- Spawn multiple AI agents with different models (Anthropic, OpenAI, Bedrock, WebLLM local)
- Agents coordinate via ring attention — shared context buffer across all agents
- Structured pipelines with task dependencies and status tracking
- Sandboxed HTML/CSS/JS apps created by agents, rendered inline
- GitHub integration (search, read files, create issues/PRs)
- Cross-tab agent mesh via BroadcastChannel + optional WebSocket relay
- MCP server connections (Streamable HTTP transport)
- Custom tool creation at runtime (agents can build their own tools)
- Encrypted settings sync via URL
- Voice input/output via local DevDuck server
- PWA with offline support

## Quick start

Serve the `loom/` directory with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open in browser, add an API key in Settings, start chatting.

## Building the Strands SDK bundle

The only build step is bundling the Strands SDK for browser use. The app itself uses native ES modules.

```bash
npm install
node build.mjs
```

Requires the [Strands SDK](https://github.com/strands-agents/sdk-typescript) cloned as a sibling directory (`../sdk-typescript`).

## Project structure

```
src/
├── app.js              # Entry point — imports everything, wires callbacks, runs init
├── state/store.js      # App state, constants, model catalog
├── models/providers.js # createModel() for all providers
├── agent/
│   ├── lifecycle.js    # spawnAgent, killAgent, selectAgent
│   ├── messaging.js    # runAgentMessage, sendMessage, streaming
│   ├── transcript.js   # Structured transcript helpers
│   └── hooks.js        # InterruptHook, SummarizingManager
├── tools/
│   ├── core.js         # render_ui, javascript_eval, storage, fetch, notify
│   ├── self-mod.js     # create_tool, update_self, list_tools, delete_tool
│   ├── mesh.js         # invoke_agent, broadcast, list_agents
│   ├── pipeline.js     # Pipeline task management
│   ├── sandbox.js      # Sandboxed HTML/CSS/JS apps
│   ├── github.js       # GitHub API tools
│   ├── cross-tab.js    # Cross-tab mesh tools
│   └── registry.js     # TOOLS array assembly
├── mesh/local.js       # BroadcastChannel + WebSocket relay
├── ui/
│   ├── messages.js     # Message rendering, streaming, tool calls
│   ├── modals.js       # Spawn, edit, settings modals
│   ├── activity.js     # Activity feed
│   ├── pipeline.js     # Pipeline visualization
│   ├── toast.js        # Toast notifications
│   └── voice.js        # Voice input/output
├── sync/
│   ├── encrypted.js    # AES-256-GCM export/import
│   └── persistence.js  # saveState/loadState
└── vendor/             # Pre-built SDK bundles
```

## Docs

- [FORK-PLAN.md](FORK-PLAN.md) — Full project structure, design decisions, phased roadmap
- [IMPROVEMENTS.md](IMPROVEMENTS.md) — 12 identified improvements from the original codebase

## License

MIT
