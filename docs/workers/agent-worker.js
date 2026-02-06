/**
 * Agent Worker - Runs a single agent in a dedicated Web Worker
 * 
 * Features:
 * - Non-blocking message processing
 * - Streaming responses to main thread
 * - Ring attention context injection
 * - Tool execution in worker context
 * 
 * Communication:
 * - postMessage({ type: 'chunk', data }) - Stream chunks
 * - postMessage({ type: 'done', data }) - Completion
 * - postMessage({ type: 'tool', data }) - Tool call requests
 * - postMessage({ type: 'error', data }) - Errors
 */

// Agent state
let agentConfig = null;
let sharedBuffer = null;
let messages = [];
let isProcessing = false;
let messageQueue = [];

// Model adapters
const modelAdapters = {
  anthropic: createAnthropicAdapter,
  openai: createOpenAIAdapter,
  bedrock: createBedrockAdapter,
  webllm: createWebLLMAdapter,
};

/**
 * Initialize agent with configuration
 */
function init(config) {
  agentConfig = {
    id: config.id,
    model: config.model || 'anthropic',
    modelId: config.modelId || 'claude-sonnet-4-20250514',
    systemPrompt: config.systemPrompt || 'You are a helpful assistant.',
    tools: config.tools || [],
    maxTokens: config.maxTokens || 4096,
    temperature: config.temperature || 1.0,
    apiKey: config.apiKey,
  };
  
  // Initialize shared buffer view if provided
  if (config.sharedBuffer) {
    sharedBuffer = new SharedArrayBuffer(config.sharedBuffer);
  }
  
  postMessage({ type: 'ready', data: { id: agentConfig.id } });
}

/**
 * Get context from ring buffer for injection
 */
function getRingContext(n = 20) {
  // Get last N messages from all agents for context
  const context = [];
  
  // From local messages
  const localContext = messages.slice(-n).map(m => ({
    agentId: agentConfig.id,
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 1000) : '[non-text]'
  }));
  
  context.push(...localContext);
  
  return context;
}

/**
 * Build system prompt with context injection
 */
function buildSystemPrompt(ringContext) {
  let prompt = agentConfig.systemPrompt;
  
  // Inject ring attention context
  if (ringContext && ringContext.length > 0) {
    const otherAgentsContext = ringContext
      .filter(m => m.agentId !== agentConfig.id)
      .map(m => `[${m.agentId}/${m.role}]: ${m.content}`)
      .join('\n');
    
    if (otherAgentsContext) {
      prompt += `\n\n## Context from other agents:\n${otherAgentsContext}`;
    }
  }
  
  return prompt;
}

/**
 * Process a message with streaming
 */
async function processMessage(message) {
  if (isProcessing) {
    // Queue the message
    messageQueue.push(message);
    postMessage({ 
      type: 'queued', 
      data: { 
        messageId: message.id,
        queuePosition: messageQueue.length 
      } 
    });
    return;
  }
  
  isProcessing = true;
  const messageId = message.id || crypto.randomUUID();
  
  try {
    postMessage({ type: 'start', data: { messageId } });
    
    // Get ring attention context
    const ringContext = getRingContext(20);
    
    // Build messages array
    const systemPrompt = buildSystemPrompt(ringContext);
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.content }
    ];
    
    // Get model adapter
    const adapter = modelAdapters[agentConfig.model];
    if (!adapter) {
      throw new Error(`Unknown model: ${agentConfig.model}`);
    }
    
    // Create streaming request
    const stream = await adapter(apiMessages, agentConfig);
    
    let fullResponse = '';
    let toolCalls = [];
    
    // Process stream
    for await (const event of stream) {
      if (event.type === 'text') {
        fullResponse += event.text;
        postMessage({ 
          type: 'chunk', 
          data: { 
            messageId, 
            chunk: event.text,
            accumulated: fullResponse
          } 
        });
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.tool);
        postMessage({
          type: 'tool_call',
          data: {
            messageId,
            tool: event.tool
          }
        });
      }
    }
    
    // Store in local messages
    messages.push({ role: 'user', content: message.content });
    messages.push({ role: 'assistant', content: fullResponse });
    
    // Send completion
    postMessage({
      type: 'done',
      data: {
        messageId,
        response: fullResponse,
        toolCalls
      }
    });
    
    // Notify ring buffer update
    postMessage({
      type: 'ring_update',
      data: {
        agentId: agentConfig.id,
        messages: messages.slice(-2)
      }
    });
    
  } catch (error) {
    postMessage({
      type: 'error',
      data: {
        messageId,
        error: error.message,
        stack: error.stack
      }
    });
  } finally {
    isProcessing = false;
    
    // Process next queued message
    if (messageQueue.length > 0) {
      const nextMessage = messageQueue.shift();
      processMessage(nextMessage);
    }
  }
}

/**
 * Execute a tool and return result
 */
async function executeTool(toolName, args) {
  // Tools are executed in main thread for DOM access
  // This requests tool execution from main thread
  return new Promise((resolve, reject) => {
    const callId = crypto.randomUUID();
    
    const handler = (event) => {
      if (event.data.type === 'tool_result' && event.data.callId === callId) {
        self.removeEventListener('message', handler);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.result);
        }
      }
    };
    
    self.addEventListener('message', handler);
    
    postMessage({
      type: 'tool_request',
      data: { callId, toolName, args }
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      self.removeEventListener('message', handler);
      reject(new Error(`Tool ${toolName} timed out`));
    }, 60000);
  });
}

// ============================================================
// MODEL ADAPTERS
// ============================================================

/**
 * Anthropic Claude adapter
 */
async function* createAnthropicAdapter(messages, config) {
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: config.modelId || 'claude-sonnet-4-20250514',
      max_tokens: config.maxTokens,
      system: systemMessage?.content || '',
      messages: chatMessages,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'content_block_delta' && data.delta?.text) {
            yield { type: 'text', text: data.delta.text };
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
}

/**
 * OpenAI GPT adapter
 */
async function* createOpenAIAdapter(messages, config) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.modelId || 'gpt-4o',
      max_tokens: config.maxTokens,
      messages: messages,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const data = JSON.parse(line.slice(6));
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            yield { type: 'text', text: content };
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
}

/**
 * AWS Bedrock adapter (via presigned URLs or Converse API)
 */
async function* createBedrockAdapter(messages, config) {
  // Bedrock requires server-side signing or Converse API
  // For browser, we'd need a proxy or use Strands SDK
  
  // Fallback: Use Strands invoke if available
  if (typeof Strands !== 'undefined' && Strands.bedrock) {
    const client = new Strands.bedrock({
      region: config.region || 'us-west-2',
      modelId: config.modelId || 'anthropic.claude-3-sonnet-20240229-v1:0'
    });
    
    const stream = await client.converse(messages, { stream: true });
    for await (const event of stream) {
      if (event.contentBlockDelta?.delta?.text) {
        yield { type: 'text', text: event.contentBlockDelta.delta.text };
      }
    }
  } else {
    throw new Error('Bedrock requires Strands SDK or server proxy');
  }
}

/**
 * WebLLM local model adapter
 */
async function* createWebLLMAdapter(messages, config) {
  // WebLLM runs in main thread, delegate to it
  const response = await new Promise((resolve, reject) => {
    const callId = crypto.randomUUID();
    
    const handler = (event) => {
      if (event.data.type === 'webllm_response' && event.data.callId === callId) {
        self.removeEventListener('message', handler);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.response);
        }
      } else if (event.data.type === 'webllm_chunk' && event.data.callId === callId) {
        // Handle streaming chunks
        postMessage({
          type: 'chunk',
          data: {
            messageId: callId,
            chunk: event.data.chunk
          }
        });
      }
    };
    
    self.addEventListener('message', handler);
    
    postMessage({
      type: 'webllm_request',
      data: { callId, messages, config }
    });
    
    // Timeout after 5 minutes for local models
    setTimeout(() => {
      self.removeEventListener('message', handler);
      reject(new Error('WebLLM request timed out'));
    }, 300000);
  });
  
  yield { type: 'text', text: response };
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

self.onmessage = async (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'init':
      init(data);
      break;
      
    case 'message':
      await processMessage(data);
      break;
      
    case 'tool_result':
      // Handled by executeTool Promise
      break;
      
    case 'webllm_response':
    case 'webllm_chunk':
      // Handled by createWebLLMAdapter Promise
      break;
      
    case 'get_context':
      // Return current context
      postMessage({
        type: 'context',
        data: {
          agentId: agentConfig.id,
          messages: messages.slice(-20)
        }
      });
      break;
      
    case 'inject_context':
      // Inject context from other agents
      // This is called by the SharedWorker bus
      break;
      
    case 'clear':
      messages = [];
      postMessage({ type: 'cleared', data: { agentId: agentConfig.id } });
      break;
      
    case 'update_config':
      Object.assign(agentConfig, data);
      postMessage({ type: 'config_updated', data: agentConfig });
      break;
      
    default:
      console.warn('Unknown message type:', type);
  }
};
