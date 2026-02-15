// ═══════════════════════════════════════════════════════════════════════════
// MESH TOOLS — invoke_agent, broadcast, list_agents, remote, pubsub
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { agentMesh } from '../mesh/local.js';
import { transcriptLastText } from '../agent/transcript.js';

export const invokeAgentTool = tool({
    name: 'invoke_agent',
    description: 'Send a message to another agent and wait for their response.',
    inputSchema: z.object({ targetAgentId: z.string(), message: z.string(), waitTime: z.number().optional() }),
    callback: async (input, { agent }) => {
        let callerAgentId = state.activeAgentId;
        for (const [id, data] of state.agents) { if (data.agent === agent) { callerAgentId = id; break; } }
        if (!state.agents.has(input.targetAgentId)) return { error: `Agent '${input.targetAgentId}' not found`, available: [...state.agents.keys()] };
        if (input.targetAgentId === callerAgentId) return { error: 'Cannot invoke yourself' };
        const result = await agentMesh.sendTo(callerAgentId, input.targetAgentId, input.message, input.waitTime || 60);
        if (result.error) return { error: result.error };
        const response = result.responses[0];
        if (response?.error) return { error: response.error };
        const fullResponse = result.streamed[input.targetAgentId] || response?.result || 'No response';
        const transcript = response?.transcript;
        return { success: true, from: input.targetAgentId, response: transcript ? transcriptLastText(transcript) : (response?.lastResponse || fullResponse.slice(-2000)), chunks: response?.chunks || 0, toolCalls: transcript ? transcript.filter(e => e.type === 'tool_use').length : 0 };
    }
});

export const broadcastToAgentsTool = tool({
    name: 'broadcast_to_agents',
    description: 'Broadcast a message to ALL other agents.',
    inputSchema: z.object({ message: z.string(), waitTime: z.number().optional() }),
    callback: async (input, { agent }) => {
        let callerAgentId = state.activeAgentId;
        for (const [id, data] of state.agents) { if (data.agent === agent) { callerAgentId = id; break; } }
        const result = await agentMesh.broadcast(callerAgentId, input.message, input.waitTime || 30);
        if (result.error) return { error: result.error };
        const responses = [];
        for (const [agentId, text] of Object.entries(result.streamed)) responses.push({ agentId, response: text });
        for (const r of result.responses) { if (r.result && !result.streamed[r.from]) responses.push({ agentId: r.from, response: r.result }); }
        return { success: true, broadcastedTo: state.agents.size - 1, responses };
    }
});

export const listAgentsTool = tool({
    name: 'list_agents',
    description: 'List all available agents with their roles and status. ALWAYS call this first before delegating tasks.',
    inputSchema: z.object({ includeRemote: z.boolean().optional() }),
    callback: async (input) => {
        const agents = agentMesh.listAgents(input?.includeRemote !== false);
        for (const a of agents) {
            if (a.location === 'local') {
                const data = state.agents.get(a.id);
                if (data?.config?.systemPrompt) a.role = data.config.systemPrompt.substring(0, 150);
                a.enabledTools = data?.config?.enabledTools || 'all';
            }
        }
        return { agents, summary: { local: agents.filter(a => a.location === 'local').length, remote: agents.filter(a => a.location === 'remote').length, total: agents.length, relayConnected: agentMesh.wsConnected }, hint: 'Use invoke_agent with targetAgentId to send tasks' };
    }
});

export const invokeRemoteAgentTool = tool({
    name: 'invoke_remote_agent',
    description: 'Send a message to an agent on a different browser/device via relay.',
    inputSchema: z.object({ instanceId: z.string(), agentId: z.string(), message: z.string(), waitTime: z.number().optional() }),
    callback: async (input, { agent }) => {
        let callerAgentId = state.activeAgentId;
        for (const [id, data] of state.agents) { if (data.agent === agent) { callerAgentId = id; break; } }
        const result = await agentMesh.sendToRemoteAgent(callerAgentId, input.instanceId, input.agentId, input.message, input.waitTime || 60);
        if (result.error) return { error: result.error };
        const response = result.responses[0];
        if (response?.error) return { error: response.error };
        return { success: true, from: `${input.agentId}@${input.instanceId}`, response: result.streamed[input.agentId] || response?.result || 'No response' };
    }
});

export const subscribeTopicTool = tool({
    name: 'subscribe_topic',
    description: 'Subscribe to a topic to receive messages.',
    inputSchema: z.object({ topic: z.string(), handler: z.string() }),
    callback: async (input) => {
        if (!state.subscriptions) state.subscriptions = new Map();
        const subId = `sub-${Date.now()}`;
        state.subscriptions.set(subId, { topic: input.topic, handler: new Function('msg', input.handler) });
        return { success: true, subscriptionId: subId, topic: input.topic };
    }
});

export const publishTopicTool = tool({
    name: 'publish_topic',
    description: 'Publish a message to a topic.',
    inputSchema: z.object({ topic: z.string(), message: z.any() }),
    callback: async (input) => {
        agentMesh.publish({ type: 'topic', topic: input.topic, data: input.message, timestamp: Date.now() });
        if (state.subscriptions) {
            for (const [, sub] of state.subscriptions) {
                if (sub.topic === input.topic) { try { sub.handler(input.message); } catch (e) { console.error('Subscription error:', e); } }
            }
        }
        return { success: true, topic: input.topic };
    }
});
