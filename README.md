# agi.diy

> Build your own AGI. Strands Agent running entirely in your browser.

## What is this?

A browser-based AI agent platform powered by [Strands SDK](https://github.com/strands-agents/sdk-typescript). No server required — everything runs client-side.

**Live:** [agi.diy](https://agi.diy)

## Features

- **100% Browser-Based** — Your API keys stay in localStorage, never sent anywhere except your chosen AI provider
- **Multiple Providers** — Anthropic Claude, OpenAI GPT-4o, or WebLLM (local, no API key needed)
- **Self-Modifying** — Agent can create its own tools that persist across sessions
- **PWA** — Install as app, works offline, push notifications

## Built-in Tools

| Tool | Description |
|------|-------------|
| `render_ui` | Create interactive HTML/CSS/JS components |
| `javascript_eval` | Execute JavaScript in browser |
| `storage_get/set` | Persist data in localStorage |
| `fetch_url` | HTTP requests (CORS restrictions apply) |
| `update_self` | Modify system prompt |
| `notify` | Push notifications |
| `create_tool` | Create new tools at runtime |

## Quick Start

1. Open [agi.diy](https://agi.diy)
2. Click **settings** → Add your API key (or use WebLLM for local)
3. Start chatting

## Local Development

```bash
cd docs
python3 -m http.server 8080
# Open http://localhost:8080
```

## Privacy

- API keys stored only in your browser's localStorage
- No telemetry, no tracking
- All processing happens client-side

## Stack

- [Strands Agents SDK](https://github.com/strands-agents/sdk-typescript) (TypeScript)
- Vanilla JS, no framework
- WebLLM for local inference

## License

Apache 2.0
