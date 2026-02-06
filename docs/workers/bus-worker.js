/**
 * Bus Worker - SharedWorker for cross-agent communication
 * 
 * This SharedWorker provides:
 * 1. Message bus between all agent workers
 * 2. Ring attention buffer management
 * 3. Broadcast capabilities
 * 4. Event coordination
 * 
 * All agent workers and the main thread connect to this single SharedWorker
 * enabling efficient cross-agent communication without main thread bottleneck.
 */

// Connected ports
const connections = new Map(); // portId -> { port, agentId, type }
let nextPortId = 0;

// Ring attention buffer (in-memory, SharedArrayBuffer not available in SharedWorker)
// We use a simple array and broadcast to all connections
const ringBuffer = [];
const MAX_RING_SIZE = 1000;

// Agent registry
const agents = new Map(); // agentId -> { status, lastMessage, created }

/**
 * Generate unique port ID
 */
function generatePortId() {
  return `port-${nextPortId++}-${Date.now()}`;
}

/**
 * Add message to ring buffer and broadcast
 */
function addToRing(agentId, message) {
  const entry = {
    id: crypto.randomUUID(),
    agentId,
    timestamp: Date.now(),
    role: message.role,
    content: typeof message.content === 'string' 
      ? message.content.slice(0, 2000) // Truncate for context
      : '[non-text]'
  };
  
  ringBuffer.push(entry);
  
  // Trim to max size (ring behavior)
  while (ringBuffer.length > MAX_RING_SIZE) {
    ringBuffer.shift();
  }
  
  // Broadcast ring update to all connections
  broadcast({
    type: 'ring_update',
    data: {
      entry,
      bufferSize: ringBuffer.length
    }
  });
}

/**
 * Get ring context for an agent (excludes their own messages optionally)
 */
function getRingContext(excludeAgentId = null, limit = 20) {
  let context = ringBuffer;
  
  if (excludeAgentId) {
    context = context.filter(e => e.agentId !== excludeAgentId);
  }
  
  return context.slice(-limit);
}

/**
 * Broadcast message to all connected ports
 */
function broadcast(message, excludePortId = null) {
  for (const [portId, conn] of connections) {
    if (portId !== excludePortId) {
      try {
        conn.port.postMessage(message);
      } catch (e) {
        // Port might be closed, remove it
        connections.delete(portId);
      }
    }
  }
}

/**
 * Send message to specific agent
 */
function sendToAgent(targetAgentId, message) {
  for (const [portId, conn] of connections) {
    if (conn.agentId === targetAgentId) {
      try {
        conn.port.postMessage(message);
        return true;
      } catch (e) {
        connections.delete(portId);
      }
    }
  }
  return false;
}

/**
 * Get all registered agents
 */
function getAgents() {
  const agentList = [];
  for (const [agentId, info] of agents) {
    agentList.push({
      id: agentId,
      ...info
    });
  }
  return agentList;
}

/**
 * Handle incoming connection
 */
self.onconnect = function(event) {
  const port = event.ports[0];
  const portId = generatePortId();
  
  // Store connection
  connections.set(portId, {
    port,
    agentId: null,
    type: 'unknown'
  });
  
  // Handle messages from this port
  port.onmessage = function(event) {
    const { type, data } = event.data;
    const conn = connections.get(portId);
    
    switch (type) {
      // ============================================
      // Connection Management
      // ============================================
      
      case 'register':
        // Register agent or main thread
        conn.agentId = data.agentId;
        conn.type = data.type || 'agent'; // 'agent' or 'main'
        
        if (data.agentId) {
          agents.set(data.agentId, {
            status: 'active',
            lastMessage: Date.now(),
            created: Date.now()
          });
        }
        
        port.postMessage({
          type: 'registered',
          data: {
            portId,
            agentId: data.agentId,
            agents: getAgents()
          }
        });
        
        // Notify others of new agent
        broadcast({
          type: 'agent_joined',
          data: {
            agentId: data.agentId,
            agents: getAgents()
          }
        }, portId);
        break;
        
      case 'unregister':
        // Remove agent
        if (conn.agentId) {
          agents.delete(conn.agentId);
          
          broadcast({
            type: 'agent_left',
            data: {
              agentId: conn.agentId,
              agents: getAgents()
            }
          }, portId);
        }
        
        connections.delete(portId);
        break;
        
      // ============================================
      // Ring Buffer Operations
      // ============================================
      
      case 'ring_add':
        // Add message to ring buffer
        addToRing(data.agentId, data.message);
        break;
        
      case 'ring_get':
        // Get ring context
        const context = getRingContext(data.excludeAgentId, data.limit || 20);
        port.postMessage({
          type: 'ring_context',
          data: {
            context,
            requestId: data.requestId
          }
        });
        break;
        
      case 'ring_clear':
        // Clear ring buffer (admin action)
        ringBuffer.length = 0;
        broadcast({ type: 'ring_cleared', data: {} });
        break;
        
      // ============================================
      // Messaging
      // ============================================
      
      case 'broadcast':
        // Broadcast to all agents
        broadcast({
          type: 'broadcast_message',
          data: {
            from: conn.agentId,
            message: data.message
          }
        }, portId);
        break;
        
      case 'send':
        // Send to specific agent
        const delivered = sendToAgent(data.targetAgentId, {
          type: 'direct_message',
          data: {
            from: conn.agentId,
            message: data.message
          }
        });
        
        port.postMessage({
          type: 'send_result',
          data: {
            delivered,
            targetAgentId: data.targetAgentId,
            requestId: data.requestId
          }
        });
        break;
        
      // ============================================
      // Status & Discovery
      // ============================================
      
      case 'get_agents':
        port.postMessage({
          type: 'agents_list',
          data: {
            agents: getAgents()
          }
        });
        break;
        
      case 'heartbeat':
        // Update agent status
        if (conn.agentId && agents.has(conn.agentId)) {
          const agent = agents.get(conn.agentId);
          agent.lastMessage = Date.now();
          agent.status = data.status || 'active';
        }
        
        port.postMessage({
          type: 'heartbeat_ack',
          data: { timestamp: Date.now() }
        });
        break;
        
      case 'get_stats':
        port.postMessage({
          type: 'stats',
          data: {
            connections: connections.size,
            agents: agents.size,
            ringBufferSize: ringBuffer.length,
            maxRingSize: MAX_RING_SIZE
          }
        });
        break;
        
      // ============================================
      // Tool Coordination
      // ============================================
      
      case 'tool_request':
        // Forward tool request to main thread
        for (const [pid, pconn] of connections) {
          if (pconn.type === 'main') {
            pconn.port.postMessage({
              type: 'tool_request',
              data: {
                ...data,
                fromAgentId: conn.agentId,
                fromPortId: portId
              }
            });
            break;
          }
        }
        break;
        
      case 'tool_result':
        // Forward tool result back to requesting agent
        const targetPortId = data.toPortId;
        const targetConn = connections.get(targetPortId);
        if (targetConn) {
          targetConn.port.postMessage({
            type: 'tool_result',
            data: {
              callId: data.callId,
              result: data.result,
              error: data.error
            }
          });
        }
        break;
        
      default:
        console.warn('SharedWorker: Unknown message type:', type);
    }
  };
  
  // Handle port close
  port.onmessageerror = function() {
    const conn = connections.get(portId);
    if (conn && conn.agentId) {
      agents.delete(conn.agentId);
      broadcast({
        type: 'agent_left',
        data: {
          agentId: conn.agentId,
          agents: getAgents()
        }
      }, portId);
    }
    connections.delete(portId);
  };
  
  // Start port
  port.start();
  
  // Send initial handshake
  port.postMessage({
    type: 'connected',
    data: {
      portId,
      ringBufferSize: ringBuffer.length,
      agents: getAgents()
    }
  });
};
