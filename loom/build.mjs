/**
 * Build strands.js browser bundle for Loom
 *
 * Bundles the Strands Agents TypeScript SDK for browser use.
 * Adapted from agi-diy/build-strands.mjs — output goes to src/vendor/strands.js
 *
 * Usage:
 *   node build.mjs
 *
 * Prerequisites:
 *   cd ../StrandsAgentsSDKTypescript && npm install && npm run build
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(__dirname, '../../sdk-typescript');
const OUT_FILE = resolve(__dirname, 'src/vendor/strands.js');
const STUBS = resolve(__dirname, 'stubs');

const ENTRY = `
  export { Agent } from '${SDK_DIR}/dist/src/agent/agent.js';
  export { AgentResult } from '${SDK_DIR}/dist/src/types/agent.js';
  export { FunctionTool } from '${SDK_DIR}/dist/src/tools/function-tool.js';
  export { tool } from '${SDK_DIR}/dist/src/tools/zod-tool.js';
  export { Tool } from '${SDK_DIR}/dist/src/tools/tool.js';
  export { Model } from '${SDK_DIR}/dist/src/models/model.js';
  export { z } from 'zod';
  export { Message, TextBlock, JsonBlock, ToolResultBlock } from '${SDK_DIR}/dist/src/types/messages.js';
  export { ImageBlock } from '${SDK_DIR}/dist/src/types/media.js';
  export {
    AfterInvocationEvent, AfterModelCallEvent, BeforeModelCallEvent, BeforeToolCallEvent
  } from '${SDK_DIR}/dist/src/hooks/index.js';
  export { SlidingWindowConversationManager } from '${SDK_DIR}/dist/src/conversation-manager/sliding-window-conversation-manager.js';
  export { NullConversationManager } from '${SDK_DIR}/dist/src/conversation-manager/null-conversation-manager.js';
  export { McpClient } from '${SDK_DIR}/dist/src/mcp.js';
  export { BedrockModel } from '${SDK_DIR}/dist/src/models/bedrock.js';
  export { AnthropicModel } from '${SDK_DIR}/dist/src/models/anthropic.js';
  export { OpenAIModel } from '${SDK_DIR}/dist/src/models/openai.js';
  export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
`;

const OPENAI_KEEP = new Set(['chat', 'responses', 'shared', 'index']);
const ANTHROPIC_KEEP = new Set(['messages', 'shared', 'index']);
const STUB_CLASS = `const S = class { constructor() {} }; export { S as default };`;

const trimPlugin = {
  name: 'trim-unused',
  setup(build) {
    build.onLoad({ filter: /openai\/resources\/.*\.mjs$/ }, args => {
      const match = args.path.match(/resources\/([^/.]+)/);
      if (match && !OPENAI_KEEP.has(match[1])) {
        return { contents: `${STUB_CLASS}\nexport const Audio=S,Batches=S,Beta=S,Completions=S,Containers=S;\nexport const Conversations=S,Embeddings=S,Evals=S,Files=S;\nexport const FineTuning=S,Graders=S,Images=S,Models=S;\nexport const Moderations=S,Realtime=S,Uploads=S,VectorStores=S;\nexport const Videos=S,Webhooks=S;`, loader: 'js' };
      }
    });
    build.onLoad({ filter: /@anthropic-ai\/sdk\/resources\/.*\.mjs$/ }, args => {
      const match = args.path.match(/resources\/([^/.]+)/);
      if (match && !ANTHROPIC_KEEP.has(match[1])) {
        return { contents: `${STUB_CLASS}\nexport const Beta=S,Completions=S,Models=S,Messages=S,Batches=S;\nexport const Files=S,Skills=S,Versions=S;`, loader: 'js' };
      }
    });
    build.onLoad({ filter: /@anthropic-ai\/sdk\/lib\/Beta.*\.mjs$/ }, args => {
      return { contents: `${STUB_CLASS}\nexport const BetaMessageStream=S,BetaToolRunner=S;`, loader: 'js' };
    });
    const MCP_TYPES_STUB = resolve(STUBS, 'mcp-types.js');
    build.onResolve({ filter: /\.\.\/types(\.js)?$/ }, args => {
      if (args.importer.includes('@modelcontextprotocol/sdk')) return { path: MCP_TYPES_STUB };
    });
    build.onLoad({ filter: /\/@modelcontextprotocol\/sdk\/.*\/shared\/auth\.js$/ }, () => ({
      contents: `const S={parse:v=>v,safeParse:v=>({success:true,data:v}),optional:()=>S,or:()=>S,merge:()=>S,transform:()=>S,looseObject:()=>S,object:()=>S,string:()=>S,array:()=>S,boolean:()=>S,number:()=>S,literal:()=>S,superRefine:()=>S,refine:()=>S};\nexport const SafeUrlSchema=S,OptionalSafeUrlSchema=S,OAuthProtectedResourceMetadataSchema=S,OAuthMetadataSchema=S,OpenIdProviderMetadataSchema=S,OpenIdProviderDiscoveryMetadataSchema=S,OAuthTokensSchema=S,OAuthErrorResponseSchema=S,OAuthClientMetadataSchema=S,OAuthClientInformationSchema=S,OAuthClientInformationFullSchema=S,OAuthClientRegistrationErrorSchema=S,OAuthTokenRevocationRequestSchema=S;\nexport function discoverOAuthMetadata(){}export function discoverOAuthProtectedResourceMetadata(){}`,
      loader: 'js'
    }));
  }
};

await build({
  stdin: { contents: ENTRY, resolveDir: SDK_DIR, loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', outfile: OUT_FILE,
  target: ['es2022'], treeShaking: true, plugins: [trimPlugin],
  nodePaths: [resolve(SDK_DIR, 'node_modules')],
  alias: {
    'zod': resolve(STUBS, 'zod'),
    'zod/v3': resolve(STUBS, 'zod/v3.js'),
    'zod/v4': resolve(STUBS, 'zod/v4.js'),
    'zod/v4/mini': resolve(STUBS, 'zod/v4-mini.js'),
    'zod-to-json-schema': resolve(STUBS, 'zod-to-json-schema.js'),
    'ajv': resolve(STUBS, 'ajv.js'),
    'ajv-formats': resolve(STUBS, 'empty.js'),
    '@aws-sdk/client-bedrock-runtime': resolve(STUBS, 'bedrock-runtime.js'),
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
    for (const [pkg, bytes] of sorted) console.log(`  ${(bytes/1024).toFixed(0).padStart(6)} KB  ${pkg}`);
  }
});

console.log(`\n✅ Built ${OUT_FILE}`);
