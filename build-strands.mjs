/**
 * Build strands.js browser bundle for agi-diy
 *
 * Bundles the Strands Agents TypeScript SDK for browser use:
 * - Real AWS SDK (BedrockModel with SigV4 + bearer token auth)
 * - Real Anthropic SDK (AnthropicModel)
 * - Real OpenAI SDK (OpenAIModel)
 * - Real MCP SDK (McpClient, SSE + Streamable HTTP transports)
 * - Node-only modules stubbed (stdio, fs, child_process, etc.)
 *
 * Usage:
 *   node build-strands.mjs
 *
 * Prerequisites:
 *   cd ../StrandsAgentsSDKTypescript && npm install && npm run build
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(__dirname, '../../StrandsAgentsSDKTypescript');
const OUT_FILE = resolve(__dirname, 'docs/strands.js');

const ENTRY = `
  // Core SDK
  export {
    Agent, AgentResult, FunctionTool, ImageBlock, JsonBlock, Message, Model, TextBlock, Tool, ToolResultBlock,
    AfterInvocationEvent, AfterModelCallEvent, BeforeModelCallEvent, BeforeToolCallEvent,
    SlidingWindowConversationManager, NullConversationManager,
    McpClient
  } from '${SDK_DIR}/dist/src/index.js';

  // Model providers
  export { BedrockModel } from '${SDK_DIR}/dist/src/models/bedrock.js';
  export { AnthropicModel } from '${SDK_DIR}/dist/src/models/anthropic.js';
  export { OpenAIModel } from '${SDK_DIR}/dist/src/models/openai.js';

  // MCP transports (browser-compatible only)
  export { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
  export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
`;

const STUBS = resolve(__dirname, 'stubs');

await build({
  stdin: { contents: ENTRY, resolveDir: SDK_DIR, loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: OUT_FILE,
  target: ['es2022'],
  treeShaking: true,
  // Stub Node-only modules
  alias: {
    '@modelcontextprotocol/sdk/client/stdio.js': resolve(STUBS, 'empty.js'),
    'node:child_process': resolve(STUBS, 'empty.js'),
    'node:events': resolve(STUBS, 'events.js'),
    'node:process': resolve(STUBS, 'empty.js'),
    'node:stream': resolve(STUBS, 'empty.js'),
    'node:stream/web': resolve(STUBS, 'empty.js'),
    'node:url': resolve(STUBS, 'empty.js'),
    'node:path': resolve(STUBS, 'empty.js'),
    'node:fs': resolve(STUBS, 'empty.js'),
    'node:os': resolve(STUBS, 'empty.js'),
    'node:crypto': resolve(STUBS, 'empty.js'),
    'node:http': resolve(STUBS, 'empty.js'),
    'node:https': resolve(STUBS, 'empty.js'),
    'node:net': resolve(STUBS, 'empty.js'),
    'node:zlib': resolve(STUBS, 'empty.js'),
    'node:buffer': resolve(STUBS, 'empty.js'),
    'node:util': resolve(STUBS, 'empty.js'),
    'node:async_hooks': resolve(STUBS, 'empty.js'),
    'child_process': resolve(STUBS, 'empty.js'),
    'events': resolve(STUBS, 'events.js'),
    'stream': resolve(STUBS, 'empty.js'),
    'fs': resolve(STUBS, 'empty.js'),
    'os': resolve(STUBS, 'empty.js'),
    'path': resolve(STUBS, 'empty.js'),
    'crypto': resolve(STUBS, 'empty.js'),
    'http': resolve(STUBS, 'empty.js'),
    'https': resolve(STUBS, 'empty.js'),
    'net': resolve(STUBS, 'empty.js'),
    'zlib': resolve(STUBS, 'empty.js'),
    'util': resolve(STUBS, 'empty.js'),
    'async_hooks': resolve(STUBS, 'empty.js'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    'process.version': '"v20.0.0"',
    'process.platform': '"browser"',
    'process.stdout': '{}',
    'process.stderr': '{}',
    'global': 'globalThis',
  },
  logLevel: 'info',
  metafile: true,
}).then(result => {
  const meta = result.metafile;
  const sizes = {};
  for (const [file, info] of Object.entries(meta.inputs)) {
    const pkg = file.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)?.[1] || 'sdk';
    sizes[pkg] = (sizes[pkg] || 0) + info.bytes;
  }
  if (process.argv.includes('--analyze')) {
    const sorted = Object.entries(sizes).sort((a, b) => b[1] - a[1]);
    console.log('\nBundle size breakdown:');
    for (const [pkg, bytes] of sorted) {
      console.log(`  ${(bytes/1024).toFixed(0).padStart(6)} KB  ${pkg}`);
    }
  }
});

console.log(`\n✅ Built ${OUT_FILE}`);
