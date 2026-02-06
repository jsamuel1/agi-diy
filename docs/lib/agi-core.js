/**
 * AGI Core - The God Object for Multi-Agent Browser System
 * 
 * This is the central orchestration layer that manages:
 * - Multiple agent workers
 * - SharedWorker message bus
 * - IndexedDB persistence
 * - WebAuthn encrypted credentials
 * - Ring attention context sharing
 * - Event coordination
 * 
 * Usage:
 *   await agi.init();
 *   agi.spawn('researcher', { model: 'anthropic', systemPrompt: '...' });
 *   agi.send('researcher', 'Hello!');
 */

class AGICore {
  constructor() {
    // Agent workers
    this.agents = new Map(); // agentId -> { worker, config, status }
    
    // Message bus (SharedWorker)
    this.bus = null;
    this.busPort = null;
    
    // IndexedDB
    this.db = null;
    
    // Encrypted credentials store
    this.credentials = new EncryptedCredentialsStore();
    
    // Event handlers
    this.handlers = new Map(); // eventType -> Set<callback>
    
    // Ring buffer (local cache, synced via bus)
    this.ringBuffer = [];
    
    // Message queue for non-blocking sends
    this.messageQueue = new Map(); // agentId -> queue
    
    // Initialization state
    this.initialized = false;
    
    // WebLLM instance (shared for local models)
    this.webllm = null;
  }
  
  /**
   * Initialize the AGI system
   */
  async init() {
    if (this.initialized) {
      console.warn('AGI already initialized');
      return this;
    }
    
    console.log('[AGI] Initializing...');
    
    // 1. Open IndexedDB
    await this.openDatabase();
    
    // 2. Connect to SharedWorker bus
    await this.connectBus();
    
    // 3. Initialize credentials store
    await this.credentials.init();
    
    // 4. Load persisted agents
    await this.loadPersistedAgents();
    
    this.initialized = true;
    console.log('[AGI] Initialized successfully');
    
    this.emit('initialized', { timestamp: Date.now() });
    
    return this;
  }
  
  /**
   * Open IndexedDB connection
   */
  async openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('agi-diy-multi', 1);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Agents store
        if (!db.objectStoreNames.contains('agents')) {
          const store = db.createObjectStore('agents', { keyPath: 'id' });
          store.createIndex('created', 'created');
          store.createIndex('updated', 'updated');
        }
        
        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('agentId', 'agentId');
          store.createIndex('timestamp', 'timestamp');
        }
        
        // Credentials store (encrypted)
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'id' });
        }
        
        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('created', 'created');
        }
        
        // Ring buffer backup
        if (!db.objectStoreNames.contains('ring_buffer')) {
          const store = db.createObjectStore('ring_buffer', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
        
        // Custom tools store
        if (!db.objectStoreNames.contains('tools')) {
          db.createObjectStore('tools', { keyPath: 'name' });
        }
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('[AGI] IndexedDB opened');
        resolve(this.db);
      };
      
      request.onerror = () => {
        console.error('[AGI] IndexedDB error:', request.error);
        reject(request.error);
      };
    });
  }
  
  /**
   * Connect to SharedWorker message bus
   */
  async connectBus() {
    return new Promise((resolve, reject) => {
      try {
        this.bus = new SharedWorker('workers/bus-worker.js');
        this.busPort = this.bus.port;
        
        this.busPort.onmessage = (event) => {
          this.handleBusMessage(event.data);
        };
        
        this.busPort.onerror = (error) => {
          console.error('[AGI] Bus error:', error);
          this.emit('bus_error', { error });
        };
        
        // Wait for connection confirmation
        const timeout = setTimeout(() => {
          reject(new Error('Bus connection timeout'));
        }, 5000);
        
        this.once('bus_connected', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        this.busPort.start();
        
        // Register as main thread
        this.busPort.postMessage({
          type: 'register',
          data: {
            agentId: 'main',
            type: 'main'
          }
        });
        
      } catch (error) {
        // SharedWorker not supported, fallback to BroadcastChannel
        console.warn('[AGI] SharedWorker not supported, using BroadcastChannel');
        this.bus = new BroadcastChannel('agi-bus');
        this.busPort = this.bus;
        this.busPort.onmessage = (event) => {
          this.handleBusMessage(event.data);
        };
        resolve();
      }
    });
  }
  
  /**
   * Handle messages from the bus
   */
  handleBusMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'connected':
        console.log('[AGI] Connected to bus');
        this.emit('bus_connected', data);
        break;
        
      case 'registered':
        console.log('[AGI] Registered with bus');
        break;
        
      case 'ring_update':
        this.ringBuffer.push(data.entry);
        // Trim local cache
        while (this.ringBuffer.length > 1000) {
          this.ringBuffer.shift();
        }
        this.emit('ring_update', data);
        break;
        
      case 'agent_joined':
        this.emit('agent_joined', data);
        break;
        
      case 'agent_left':
        this.emit('agent_left', data);
        break;
        
      case 'broadcast_message':
        this.emit('broadcast', data);
        break;
        
      case 'tool_request':
        this.handleToolRequest(data);
        break;
        
      default:
        // Forward to relevant handlers
        this.emit(type, data);
    }
  }
  
  /**
   * Handle tool execution requests from agent workers
   */
  async handleToolRequest(data) {
    const { callId, toolName, args, fromAgentId, fromPortId } = data;
    
    try {
      // Get tool from registry
      const tool = window.agiTools?.[toolName];
      
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }
      
      // Execute tool
      const result = await tool(args);
      
      // Send result back via bus
      this.busPort.postMessage({
        type: 'tool_result',
        data: {
          callId,
          toPortId: fromPortId,
          result
        }
      });
      
    } catch (error) {
      this.busPort.postMessage({
        type: 'tool_result',
        data: {
          callId,
          toPortId: fromPortId,
          error: error.message
        }
      });
    }
  }
  
  /**
   * Load persisted agents from IndexedDB
   */
  async loadPersistedAgents() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('agents', 'readonly');
      const store = tx.objectStore('agents');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const agents = request.result;
        console.log(`[AGI] Found ${agents.length} persisted agents`);
        // Don't auto-spawn - let UI decide
        this.emit('agents_loaded', { agents });
        resolve(agents);
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Spawn a new agent
   */
  async spawn(agentId, config = {}) {
    if (this.agents.has(agentId)) {
      console.warn(`[AGI] Agent ${agentId} already exists`);
      return this.agents.get(agentId);
    }
    
    console.log(`[AGI] Spawning agent: ${agentId}`);
    
    // Get API key from credentials store
    let apiKey = config.apiKey;
    if (!apiKey && config.model) {
      const cred = await this.credentials.get(config.model);
      apiKey = cred?.apiKey;
    }
    
    // Create worker
    const worker = new Worker('workers/agent-worker.js');
    
    const agent = {
      worker,
      config: {
        id: agentId,
        model: config.model || 'bedrock',
        modelId: config.modelId || 'global.anthropic.claude-opus-4-6-v1',
        systemPrompt: config.systemPrompt || 'You are a helpful assistant.',
        tools: config.tools || [],
        maxTokens: config.maxTokens || 60000,
        temperature: config.temperature || 1.0,
        apiKey
      },
      status: 'initializing',
      created: Date.now(),
      messages: []
    };
    
    // Handle worker messages
    worker.onmessage = (event) => {
      this.handleWorkerMessage(agentId, event.data);
    };
    
    worker.onerror = (error) => {
      console.error(`[AGI] Worker error for ${agentId}:`, error);
      agent.status = 'error';
      this.emit('agent_error', { agentId, error });
    };
    
    // Initialize worker
    worker.postMessage({
      type: 'init',
      data: agent.config
    });
    
    // Store agent
    this.agents.set(agentId, agent);
    
    // Initialize message queue
    this.messageQueue.set(agentId, []);
    
    // Persist to IndexedDB
    await this.persistAgent(agent);
    
    this.emit('agent_spawned', { agentId, config: agent.config });
    
    return agent;
  }
  
  /**
   * Handle messages from agent workers
   */
  handleWorkerMessage(agentId, message) {
    const { type, data } = message;
    const agent = this.agents.get(agentId);
    
    if (!agent) return;
    
    switch (type) {
      case 'ready':
        agent.status = 'ready';
        this.emit('agent_ready', { agentId });
        break;
        
      case 'start':
        agent.status = 'processing';
        this.emit('message_start', { agentId, messageId: data.messageId });
        break;
        
      case 'chunk':
        this.emit('chunk', { agentId, ...data });
        break;
        
      case 'done':
        agent.status = 'ready';
        agent.messages.push(
          { role: 'user', content: data.userMessage },
          { role: 'assistant', content: data.response }
        );
        this.emit('message_done', { agentId, ...data });
        
        // Add to ring buffer via bus
        this.busPort.postMessage({
          type: 'ring_add',
          data: {
            agentId,
            message: { role: 'assistant', content: data.response }
          }
        });
        break;
        
      case 'error':
        agent.status = 'error';
        this.emit('agent_error', { agentId, ...data });
        break;
        
      case 'tool_request':
        this.handleToolRequest({ ...data, fromAgentId: agentId });
        break;
        
      case 'queued':
        this.emit('message_queued', { agentId, ...data });
        break;
        
      case 'webllm_request':
        // Forward WebLLM request to main thread WebLLM instance
        this.handleWebLLMRequest(agentId, data);
        break;
        
      default:
        this.emit(`worker_${type}`, { agentId, ...data });
    }
  }
  
  /**
   * Handle WebLLM requests from workers
   */
  async handleWebLLMRequest(agentId, data) {
    const { callId, messages, config } = data;
    const agent = this.agents.get(agentId);
    
    if (!agent) return;
    
    try {
      if (!this.webllm) {
        throw new Error('WebLLM not initialized');
      }
      
      let response = '';
      
      // Stream chunks back to worker
      for await (const chunk of this.webllm.stream(messages, config)) {
        response += chunk;
        agent.worker.postMessage({
          type: 'webllm_chunk',
          data: { callId, chunk }
        });
      }
      
      agent.worker.postMessage({
        type: 'webllm_response',
        data: { callId, response }
      });
      
    } catch (error) {
      agent.worker.postMessage({
        type: 'webllm_response',
        data: { callId, error: error.message }
      });
    }
  }
  
  /**
   * Send message to agent (non-blocking)
   */
  send(agentId, content) {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      console.error(`[AGI] Agent not found: ${agentId}`);
      return null;
    }
    
    const messageId = crypto.randomUUID();
    
    // Queue message
    this.messageQueue.get(agentId).push({
      id: messageId,
      content,
      status: 'queued',
      created: Date.now()
    });
    
    // Send to worker (worker handles its own queue)
    agent.worker.postMessage({
      type: 'message',
      data: {
        id: messageId,
        content
      }
    });
    
    // Add user message to ring buffer
    this.busPort.postMessage({
      type: 'ring_add',
      data: {
        agentId,
        message: { role: 'user', content }
      }
    });
    
    this.emit('message_sent', { agentId, messageId, content });
    
    return messageId; // Return immediately
  }
  
  /**
   * Broadcast message to all agents
   */
  broadcast(content) {
    const messageIds = [];
    
    for (const agentId of this.agents.keys()) {
      const msgId = this.send(agentId, content);
      if (msgId) {
        messageIds.push({ agentId, messageId: msgId });
      }
    }
    
    this.emit('broadcast_sent', { messageIds, content });
    
    return messageIds;
  }
  
  /**
   * Kill an agent
   */
  async kill(agentId) {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      console.warn(`[AGI] Agent not found: ${agentId}`);
      return false;
    }
    
    // Terminate worker
    agent.worker.terminate();
    
    // Remove from map
    this.agents.delete(agentId);
    this.messageQueue.delete(agentId);
    
    // Remove from bus
    this.busPort.postMessage({
      type: 'unregister',
      data: { agentId }
    });
    
    // Remove from IndexedDB
    await this.deleteAgent(agentId);
    
    this.emit('agent_killed', { agentId });
    
    return true;
  }
  
  /**
   * Get agent status
   */
  status(agentId) {
    if (agentId) {
      const agent = this.agents.get(agentId);
      return agent ? {
        id: agentId,
        status: agent.status,
        model: agent.config.model,
        messages: agent.messages.length,
        created: agent.created
      } : null;
    }
    
    // Return all agents status
    const statuses = {};
    for (const [id, agent] of this.agents) {
      statuses[id] = {
        status: agent.status,
        model: agent.config.model,
        messages: agent.messages.length,
        created: agent.created
      };
    }
    return statuses;
  }
  
  /**
   * Get ring context
   */
  getContext(limit = 20) {
    return this.ringBuffer.slice(-limit);
  }
  
  // ============================================
  // Persistence
  // ============================================
  
  async persistAgent(agent) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('agents', 'readwrite');
      const store = tx.objectStore('agents');
      
      const record = {
        id: agent.config.id,
        config: {
          ...agent.config,
          apiKey: undefined // Don't persist API keys here
        },
        created: agent.created,
        updated: Date.now()
      };
      
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteAgent(agentId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('agents', 'readwrite');
      const store = tx.objectStore('agents');
      const request = store.delete(agentId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  // ============================================
  // Event System
  // ============================================
  
  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event).add(callback);
    return () => this.off(event, callback);
  }
  
  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }
  
  off(event, callback) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(callback);
    }
  }
  
  emit(event, data) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const callback of handlers) {
        try {
          callback(data);
        } catch (error) {
          console.error(`[AGI] Event handler error (${event}):`, error);
        }
      }
    }
  }
  
  // ============================================
  // Export/Import
  // ============================================
  
  async export(includeCredentials = false) {
    const data = {
      version: 1,
      exported: Date.now(),
      agents: [],
      ringBuffer: this.ringBuffer.slice(-100),
      tools: []
    };
    
    // Export agents
    for (const [id, agent] of this.agents) {
      data.agents.push({
        id,
        config: {
          ...agent.config,
          apiKey: undefined
        },
        messages: agent.messages.slice(-50),
        created: agent.created
      });
    }
    
    // Export tools
    const tx = this.db.transaction('tools', 'readonly');
    const store = tx.objectStore('tools');
    data.tools = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    // Optionally include encrypted credentials
    if (includeCredentials) {
      data.credentials = await this.credentials.exportEncrypted();
    }
    
    return data;
  }
  
  async import(data) {
    if (data.version !== 1) {
      throw new Error('Unsupported export version');
    }
    
    // Import agents
    for (const agentData of data.agents) {
      if (!this.agents.has(agentData.id)) {
        await this.spawn(agentData.id, agentData.config);
      }
    }
    
    // Import tools
    const tx = this.db.transaction('tools', 'readwrite');
    const store = tx.objectStore('tools');
    for (const tool of data.tools) {
      await new Promise((resolve, reject) => {
        const request = store.put(tool);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    
    // Import credentials if present
    if (data.credentials) {
      await this.credentials.importEncrypted(data.credentials);
    }
    
    this.emit('imported', { agents: data.agents.length, tools: data.tools.length });
  }
  
  /**
   * Export to downloadable file
   */
  async exportToFile(includeCredentials = false) {
    const data = await this.export(includeCredentials);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `agi-export-${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }
}

// ============================================================
// ENCRYPTED CREDENTIALS STORE
// ============================================================

class EncryptedCredentialsStore {
  constructor() {
    this.db = null;
    this.cryptoKey = null;
  }
  
  async init() {
    // Use AGI's IndexedDB
    // Crypto key will be derived on first access
  }
  
  /**
   * Derive encryption key from password
   */
  async deriveKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('agi-diy-credentials'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  /**
   * Try WebAuthn for key derivation
   */
  async tryWebAuthn() {
    try {
      if (!window.PublicKeyCredential) {
        return null;
      }
      
      // Check if we have a stored credential
      const stored = localStorage.getItem('agi-webauthn-id');
      
      if (stored) {
        // Authenticate with existing credential
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: location.hostname,
            userVerification: 'required',
            allowCredentials: [{
              id: Uint8Array.from(atob(stored), c => c.charCodeAt(0)),
              type: 'public-key'
            }]
          }
        });
        
        return assertion;
      }
      
      return null;
    } catch (error) {
      console.warn('[AGI] WebAuthn not available:', error);
      return null;
    }
  }
  
  /**
   * Register WebAuthn credential
   */
  async registerWebAuthn() {
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'agi.diy', id: location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: 'agi-user',
            displayName: 'AGI User'
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required'
          }
        }
      });
      
      // Store credential ID
      localStorage.setItem('agi-webauthn-id', 
        btoa(String.fromCharCode(...new Uint8Array(credential.rawId))));
      
      return credential;
    } catch (error) {
      console.warn('[AGI] WebAuthn registration failed:', error);
      return null;
    }
  }
  
  /**
   * Store credential (encrypted)
   */
  async set(provider, credentials) {
    const key = this.cryptoKey || await this.deriveKey('agi-default-key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(credentials))
    );
    
    const record = {
      id: provider,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
      updated: Date.now()
    };
    
    // Store in IndexedDB (AGI's db)
    const db = window.agi?.db;
    if (db) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('credentials', 'readwrite');
        const store = tx.objectStore('credentials');
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
  
  /**
   * Get credential (decrypted)
   */
  async get(provider) {
    const db = window.agi?.db;
    if (!db) return null;
    
    return new Promise(async (resolve, reject) => {
      const tx = db.transaction('credentials', 'readonly');
      const store = tx.objectStore('credentials');
      const request = store.get(provider);
      
      request.onsuccess = async () => {
        const record = request.result;
        if (!record) {
          resolve(null);
          return;
        }
        
        try {
          const key = this.cryptoKey || await this.deriveKey('agi-default-key');
          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
            key,
            new Uint8Array(record.data)
          );
          
          resolve(JSON.parse(new TextDecoder().decode(decrypted)));
        } catch (error) {
          console.error('[AGI] Credential decryption failed:', error);
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Export all credentials (encrypted)
   */
  async exportEncrypted() {
    const db = window.agi?.db;
    if (!db) return [];
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('credentials', 'readonly');
      const store = tx.objectStore('credentials');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Import encrypted credentials
   */
  async importEncrypted(credentials) {
    const db = window.agi?.db;
    if (!db) return;
    
    const tx = db.transaction('credentials', 'readwrite');
    const store = tx.objectStore('credentials');
    
    for (const cred of credentials) {
      await new Promise((resolve, reject) => {
        const request = store.put(cred);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
}

// Create global instance
window.agi = new AGICore();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AGICore, EncryptedCredentialsStore };
}
