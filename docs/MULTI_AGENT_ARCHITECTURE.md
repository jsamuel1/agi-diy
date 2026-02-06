# Multi-Agent Browser AGI Architecture

## 🧠 Core Innovation: Concurrent Non-Blocking Multi-Agent System

### Problem with Current index.html
- Single agent on main thread
- One background thread for ambient mode
- Messages block until complete
- No shared context between agents

### Solution: Web Workers + SharedArrayBuffer + IndexedDB

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            MAIN THREAD (UI)                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  AGI God Object                                                  │   │
│  │  {                                                               │   │
│  │    agents: { agent1: {...}, agent2: {...} },                    │   │
│  │    messages: SharedRingBuffer,                                   │   │
│  │    context: EncryptedStore,                                     │   │
│  │    tools: SharedToolRegistry                                     │   │
│  │  }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           │                    │                    │                   │
│           ▼                    ▼                    ▼                   │
│    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│    │ AgentWorker1 │    │ AgentWorker2 │    │ AgentWorkerN │           │
│    │ (Web Worker) │    │ (Web Worker) │    │ (Web Worker) │           │
│    └──────────────┘    └──────────────┘    └──────────────┘           │
│           │                    │                    │                   │
│           └────────────────────┼────────────────────┘                   │
│                                ▼                                        │
│                    ┌──────────────────────┐                            │
│                    │   SharedWorker       │                            │
│                    │   (Message Bus +     │                            │
│                    │    Ring Attention)   │                            │
│                    └──────────────────────┘                            │
│                                │                                        │
│                                ▼                                        │
│                    ┌──────────────────────┐                            │
│                    │      IndexedDB       │                            │
│                    │  (Persistent State)  │                            │
│                    └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. AGI God Object
```javascript
const agi = {
  // Agent instances - each can run concurrently
  agents: new Map(),
  
  // Shared message history (ring buffer in SharedArrayBuffer)
  messages: new SharedRingBuffer(10000),
  
  // Encrypted credentials store (WebAuthn)
  credentials: new EncryptedStore(),
  
  // Shared tools available to all agents
  tools: new SharedToolRegistry(),
  
  // IndexedDB connection
  db: null,
  
  // Event bus for agent communication
  bus: new BroadcastChannel('agi-bus'),
  
  // Create new agent
  spawn(id, config) { ... },
  
  // Send message to agent (non-blocking)
  send(agentId, message) { ... },
  
  // Broadcast to all agents
  broadcast(message) { ... },
  
  // Export encrypted state
  export(password) { ... },
  
  // Import state
  import(encrypted, password) { ... }
};
```

### 2. Agent Worker (runs in Web Worker)
```javascript
// agent-worker.js
class AgentWorker {
  constructor(config) {
    this.id = config.id;
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    
    // Connect to SharedWorker for message bus
    this.bus = new SharedWorker('bus-worker.js');
    
    // Subscribe to ring attention updates
    this.bus.port.onmessage = this.onBusMessage.bind(this);
  }
  
  // Process message (streaming, non-blocking)
  async process(message) {
    // 1. Get ring attention context from shared buffer
    const context = await this.getSharedContext();
    
    // 2. Inject context into prompt
    const enhancedPrompt = this.injectContext(message, context);
    
    // 3. Stream to model
    for await (const event of this.model.stream(enhancedPrompt)) {
      // Post chunks back to main thread
      self.postMessage({ type: 'chunk', data: event });
    }
    
    // 4. Append result to shared ring buffer
    await this.appendToSharedContext(message, result);
    
    // 5. Persist to IndexedDB
    await this.persist();
  }
}
```

### 3. Ring Attention Pattern (from DevDuck)
```javascript
// Shared context that all agents can read/write
class SharedRingBuffer {
  constructor(maxMessages = 10000) {
    // SharedArrayBuffer for cross-worker access
    this.buffer = new SharedArrayBuffer(maxMessages * 4096);
    this.view = new DataView(this.buffer);
    this.messages = [];
    this.head = 0;
  }
  
  // Add message to ring buffer
  push(message) {
    const serialized = JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      agentId: message.agentId,
      role: message.role,
      content: message.content.slice(0, 2000), // Truncate for context
    });
    
    // Atomic write
    Atomics.store(this.view, this.head * 4096, serialized);
    this.head = (this.head + 1) % this.maxMessages;
  }
  
  // Get last N messages for context injection
  getContext(n = 20) {
    const context = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.head - i - 1 + this.maxMessages) % this.maxMessages;
      const msg = Atomics.load(this.view, idx * 4096);
      if (msg) context.unshift(JSON.parse(msg));
    }
    return context;
  }
}
```

### 4. WebAuthn Encrypted Credentials
```javascript
class EncryptedStore {
  constructor() {
    this.db = null;
    this.credential = null;
  }
  
  // Register biometric credential
  async register() {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'agi.diy', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'user',
          displayName: 'AGI User'
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Face ID, Touch ID
          userVerification: 'required'
        }
      }
    });
    
    this.credential = credential;
    return credential;
  }
  
  // Authenticate and decrypt
  async authenticate() {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: 'required'
      }
    });
    
    // Derive encryption key from assertion
    return this.deriveKey(assertion);
  }
  
  // Encrypt API keys
  async encrypt(data) {
    const key = await this.authenticate();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(data))
    );
    return { iv, encrypted };
  }
  
  // Decrypt API keys
  async decrypt(encrypted) {
    const key = await this.authenticate();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: encrypted.iv },
      key,
      encrypted.encrypted
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }
  
  // Export as downloadable file
  async exportToFile() {
    const data = await this.encrypt(this.getAllCredentials());
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `agi-credentials-${Date.now()}.enc`;
    a.click();
    
    URL.revokeObjectURL(url);
  }
}
```

### 5. IndexedDB Persistent Storage
```javascript
class AGIDatabase {
  constructor() {
    this.dbName = 'agi-diy';
    this.version = 1;
  }
  
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Agents store
        if (!db.objectStoreNames.contains('agents')) {
          const agentsStore = db.createObjectStore('agents', { keyPath: 'id' });
          agentsStore.createIndex('created', 'created');
        }
        
        // Messages store (ring buffer backup)
        if (!db.objectStoreNames.contains('messages')) {
          const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
          messagesStore.createIndex('agentId', 'agentId');
          messagesStore.createIndex('timestamp', 'timestamp');
        }
        
        // Credentials store (encrypted)
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'id' });
        }
        
        // Sessions store (for resume)
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionsStore.createIndex('created', 'created');
        }
        
        // Tools store (custom tools)
        if (!db.objectStoreNames.contains('tools')) {
          db.createObjectStore('tools', { keyPath: 'name' });
        }
      };
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
```

### 6. Non-Blocking Message Queue
```javascript
class MessageQueue {
  constructor() {
    this.queues = new Map(); // agentId -> message queue
    this.processing = new Map(); // agentId -> boolean
  }
  
  // Enqueue message (returns immediately)
  enqueue(agentId, message) {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
    
    const messageId = crypto.randomUUID();
    this.queues.get(agentId).push({
      id: messageId,
      message,
      status: 'queued',
      created: Date.now()
    });
    
    // Start processing if not already
    this.processQueue(agentId);
    
    return messageId; // Return immediately
  }
  
  // Process queue in background
  async processQueue(agentId) {
    if (this.processing.get(agentId)) return;
    this.processing.set(agentId, true);
    
    const queue = this.queues.get(agentId);
    
    while (queue.length > 0) {
      const item = queue[0];
      item.status = 'processing';
      
      try {
        // Send to worker (non-blocking)
        await this.sendToWorker(agentId, item.message);
        item.status = 'completed';
      } catch (error) {
        item.status = 'error';
        item.error = error.message;
      }
      
      queue.shift();
    }
    
    this.processing.set(agentId, false);
  }
}
```

## File Structure

```
/agi/docs/
├── index.html          # Current single-agent version
├── agi.html            # NEW: Multi-agent version
├── strands.js          # Strands SDK
├── webllm.js           # WebLLM support
├── vision.js           # Vision/screen capture
├── context-injector.js # Context tracking
├── map.js              # Map background
├── tools/
│   └── google.js       # Google API tools
│
# NEW FILES:
├── workers/
│   ├── agent-worker.js    # Agent execution worker
│   ├── bus-worker.js      # SharedWorker message bus
│   └── db-worker.js       # IndexedDB worker
├── lib/
│   ├── agi-core.js        # God object + orchestration
│   ├── ring-buffer.js     # SharedArrayBuffer ring buffer
│   ├── encrypted-store.js # WebAuthn encryption
│   └── message-queue.js   # Non-blocking queue
└── sw-multi.js            # Service worker for multi-agent
```

## Usage Examples

```javascript
// Initialize the AGI system
await agi.init();

// Spawn multiple agents
agi.spawn('researcher', {
  model: 'bedrock',
  systemPrompt: 'You are a research assistant...',
  tools: ['fetch_url', 'storage_get', 'storage_set']
});

agi.spawn('coder', {
  model: 'anthropic', 
  systemPrompt: 'You are a code assistant...',
  tools: ['javascript_eval', 'render_ui']
});

agi.spawn('reviewer', {
  model: 'openai',
  systemPrompt: 'You are a code reviewer...',
  tools: ['storage_get', 'notify']
});

// Send messages (all process concurrently!)
const msgId1 = agi.send('researcher', 'Find documentation on Web Workers');
const msgId2 = agi.send('coder', 'Implement a SharedArrayBuffer ring buffer');
const msgId3 = agi.send('reviewer', 'Review the last 5 code outputs');

// All three start working immediately!

// Stream responses as they arrive
agi.on('chunk', (agentId, chunk) => {
  console.log(`[${agentId}]: ${chunk}`);
});

// Broadcast to all agents
agi.broadcast('Summarize your progress');

// Export encrypted credentials
await agi.credentials.exportToFile();

// Save state to IndexedDB
await agi.save();
```

## Key Differences from Current index.html

| Feature | Current | New Multi-Agent |
|---------|---------|-----------------|
| Agents | 1 main + 1 ambient | Unlimited concurrent |
| Blocking | Yes, waits for response | Non-blocking queue |
| Context Sharing | None | Ring attention buffer |
| Storage | localStorage | IndexedDB (structured) |
| Encryption | Password-based | WebAuthn biometrics |
| Workers | None (main thread) | Web Workers per agent |
| Message Bus | None | SharedWorker + BroadcastChannel |

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] IndexedDB setup
- [ ] Web Worker scaffolding
- [ ] SharedWorker message bus
- [ ] BroadcastChannel events

### Phase 2: Agent System
- [ ] AgentWorker class
- [ ] Non-blocking message queue
- [ ] Streaming to main thread

### Phase 3: Ring Attention
- [ ] SharedArrayBuffer ring buffer
- [ ] Context injection
- [ ] Cross-agent context sharing

### Phase 4: Security
- [ ] WebAuthn registration
- [ ] Credential encryption
- [ ] Export/import encrypted files

### Phase 5: UI
- [ ] Multi-agent chat interface
- [ ] Agent spawning UI
- [ ] Status dashboard
- [ ] Per-agent tool toggles

## References

- DevDuck: Session recording, ring attention, ambient mode
- TinyAI: Concurrent message processing, dynamic UI
- Strands Coder: Sub-agent spawning, system prompt evolution
- Current index.html: Model providers, tool system, context injection
