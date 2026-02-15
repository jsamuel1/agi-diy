// ═══════════════════════════════════════════════════════════════════════════
// AGENT MESH — P2P messaging (local BroadcastChannel + remote via AgentMesh)
// ═══════════════════════════════════════════════════════════════════════════

import { state } from '../state/store.js';
import { showToast } from '../ui/toast.js';
import { transcriptPushText, transcriptFullText, transcriptLastText } from '../agent/transcript.js';
import { appendActivityFeed, activityLog, renderActivityEntry } from '../ui/activity.js';
import { updateRingUI } from '../ui/messages.js';

let updateAgentUIFn = null;
let updateMeshLogFn = null;

export function setMeshCallbacks({ updateAgentUI, updateMeshLog }) {
    updateAgentUIFn = updateAgentUI;
    updateMeshLogFn = updateMeshLog;
}

export const agentMesh = {
    // Local mesh (same-origin tabs)
    bus: new BroadcastChannel('agi-mesh'),

    // Remote mesh (delegated to AgentMesh relay)
    get wsConnected() { return window.AgentMesh?.relayConnected || false; },
    get remotePeers() { return new Map(); }, // AgentMesh manages these now

    // Shared state
    pendingRequests: new Map(),
    messageLog: [],

    init() {
        // Local mesh
        this.bus.onmessage = (e) => this.handleMessage(e.data, 'local');

        // Subscribe to relay status for UI updates
        if (window.AgentMesh) {
            window.AgentMesh.subscribe('relay-status', (s) => this.updateWsStatus(s.connected));
            window.AgentMesh.subscribe('relay-peers', () => this.updateRemotePeersUI());
        }

        console.log(`🔗 Agent mesh initialized (instance: ${window.AgentMesh?.relayInstanceId || 'unknown'})`);
    },

    connectRelay(url) { window.AgentMesh?.connectRelay(url); },
    disconnectRelay() { window.AgentMesh?.disconnectRelay(); },
    sendRemote(msg) { window.AgentMesh?.sendRelay(msg); },

    updateWsStatus(connected) {
        const el = document.getElementById('wsStatus');
        if (el) el.innerHTML = connected ? '<span style="color:#0f0">● Connected</span>' : '<span style="color:#f66">● Disconnected</span>';
    },

    updateRemotePeersUI() {
        const el = document.getElementById('remotePeersList');
        if (!el) return;
        const peers = window.AgentMesh?.getRelayPeers() || [];
        if (peers.length === 0) { el.innerHTML = 'No remote peers connected'; return; }
        el.innerHTML = peers.map(peer => {
            const agentCount = peer.agents?.length || 0;
            const age = Math.round((Date.now() - peer.lastSeen) / 1000);
            return `<div style="margin-bottom:4px;"><span style="color:#0f0">●</span> ${peer.hostname || '?'} <span style="color:var(--text-tertiary)">(${agentCount} agents, ${age}s ago)</span></div>`;
        }).join('');
    },

    handleMessage(msg, source) {
        const { type, from, to, turnId, data } = msg;
        this.messageLog.push({ type, from, to, turnId, source, data: typeof data === 'string' ? data.slice(0, 100) : data, timestamp: Date.now() });
        if (this.messageLog.length > 200) this.messageLog.shift();
        if (updateMeshLogFn) updateMeshLogFn();

        if ((type === 'presence' || type === 'heartbeat') && source === 'remote') {
            this.updateRemotePeersUI(); return;
        }

        if (type === 'broadcast' || type === 'direct') {
            if (source === 'remote' && from === (window.AgentMesh?.relayInstanceId || '')) return;
            for (const [agentId] of state.agents) {
                if (type === 'direct' && agentId !== to) continue;
                if (from === agentId) continue;
                this.processIncomingCommand(agentId, from, turnId, data.command, source);
            }
            return;
        }

        if (type === 'stream' || type === 'ack' || type === 'turn_end' || type === 'error') {
            const pending = this.pendingRequests.get(turnId);
            if (!pending) return;
            if (type === 'stream') { if (!pending.streamed[from]) pending.streamed[from] = ''; pending.streamed[from] += data.chunk; }
            else if (type === 'ack') { showToast(`🔗 ${from}: Processing...`); }
            else if (type === 'turn_end') { pending.responses.push({ from, result: data.result, lastResponse: data.lastResponse, transcript: data.transcript, chunks: data.chunks }); pending.completed++; if (pending.completed >= pending.expected || pending.timeout) pending.resolve(pending); }
            else if (type === 'error') { pending.responses.push({ from, error: data.error }); pending.completed++; }
        }
    },

    async processIncomingCommand(agentId, fromId, turnId, command, source) {
        const agentData = state.agents.get(agentId);
        if (!agentData) return;
        this.publish({ type: 'ack', from: agentId, to: fromId, turnId, timestamp: Date.now() });
        agentData.status = 'processing';
        if (updateAgentUIFn) updateAgentUIFn();
        try {
            const transcript = [];
            let chunkCount = 0;
            const sourceLabel = source === 'remote' ? `[Remote: ${fromId}]` : `[From agent ${fromId}]`;
            for await (const event of agentData.agent.stream(`${sourceLabel}: ${command}`)) {
                if (event?.type === 'modelContentBlockDeltaEvent' && event.delta?.type === 'textDelta') {
                    transcriptPushText(transcript, event.delta.text); chunkCount++;
                    this.publish({ type: 'stream', from: agentId, to: fromId, turnId, data: { chunk: event.delta.text, chunkNum: chunkCount }, timestamp: Date.now() });
                } else if (event?.type === 'beforeToolCallEvent') {
                    transcript.push({ type: 'tool_use', name: event.toolUse?.name, toolId: event.toolUse?.toolUseId, input: event.toolUse?.input });
                    appendActivityFeed(agentId, `🔧 ${event.toolUse?.name}`, 'tool', { input: event.toolUse?.input });
                } else if (event?.type === 'afterToolCallEvent') {
                    transcript.push({ type: 'tool_result', name: event.toolUse?.name, toolId: event.toolUse?.toolUseId, status: event.result?.status || 'success', output: event.result });
                    const last = activityLog.findLast(e => e.type === 'tool' && e.agentId === agentId);
                    if (last && event.result) { last.extra = { ...last.extra, output: event.result }; const feed = document.getElementById('activityFeed'); if (feed) renderActivityEntry(feed, last); }
                }
            }
            const fullText = transcriptFullText(transcript);
            this.publish({ type: 'turn_end', from: agentId, to: fromId, turnId, data: { result: fullText, lastResponse: transcriptLastText(transcript), transcript, chunks: chunkCount }, timestamp: Date.now() });
            agentData.messages.push({ role: 'user', content: `${sourceLabel}: ${command}`, timestamp: Date.now() });
            agentData.messages.push({ role: 'assistant', transcript, content: transcriptLastText(transcript), timestamp: Date.now() });
            if (fullText) appendActivityFeed(agentId, fullText.replace(/[#*`]/g, '').substring(0, 1000));
            state.ringBuffer.push({ agentId, role: 'assistant', content: fullText, timestamp: Date.now() });
            if (window.AgentMesh?.addToRingContext) window.AgentMesh.addToRingContext(agentId, 'multi', fullText.slice(0, 500));
            updateRingUI();
        } catch (e) {
            this.publish({ type: 'error', from: agentId, to: fromId, turnId, data: { error: e.message }, timestamp: Date.now() });
            agentData.status = 'error';
            appendActivityFeed(agentId, `❌ Error: ${e.message}`, 'msg');
        }
        if (agentData.status !== 'error') agentData.status = 'ready';
        if (updateAgentUIFn) updateAgentUIFn();
    },

    publish(msg) {
        this.bus.postMessage(msg);
        this.sendRemote(msg);
        setTimeout(() => this.handleMessage(msg, 'local'), 0);
    },

    async broadcast(fromAgentId, command, waitTime = 30) {
        const turnId = crypto.randomUUID().slice(0, 8);
        let peerCount = state.agents.size - 1;
        const relayPeers = window.AgentMesh?.getRelayPeers() || [];
        for (const peer of relayPeers) peerCount += peer.agents?.length || 0;
        if (peerCount === 0) return { error: 'No other agents to broadcast to' };
        return new Promise((resolve) => {
            const pending = { resolve, responses: [], streamed: {}, completed: 0, expected: peerCount, timeout: false };
            this.pendingRequests.set(turnId, pending);
            this.publish({ type: 'broadcast', from: fromAgentId, turnId, data: { command }, timestamp: Date.now() });
            setTimeout(() => { pending.timeout = true; resolve(pending); this.pendingRequests.delete(turnId); }, waitTime * 1000);
        });
    },

    async sendTo(fromAgentId, toAgentId, command, waitTime = 60) {
        const turnId = crypto.randomUUID().slice(0, 8);
        if (!state.agents.has(toAgentId)) return { error: `Agent ${toAgentId} not found` };
        return new Promise((resolve) => {
            const pending = { resolve, responses: [], streamed: {}, completed: 0, expected: 1, timeout: false };
            this.pendingRequests.set(turnId, pending);
            this.publish({ type: 'direct', from: fromAgentId, to: toAgentId, turnId, data: { command }, timestamp: Date.now() });
            setTimeout(() => { pending.timeout = true; resolve(pending); this.pendingRequests.delete(turnId); }, waitTime * 1000);
        });
    },

    listAgents(includeRemote = true) {
        const agents = [];
        for (const [id, data] of state.agents) {
            agents.push({ id, location: 'local', instanceId: window.AgentMesh?.relayInstanceId || 'unknown', status: data.status, provider: data.config.provider, model: data.config.modelId || 'default', messageCount: data.messages.length });
        }
        if (includeRemote) {
            const peers = window.AgentMesh?.getRelayPeers() || [];
            for (const peer of peers) {
                for (const agentId of peer.agents || []) {
                    agents.push({ id: agentId, location: 'remote', instanceId: peer.instanceId, hostname: peer.hostname, lastSeen: peer.lastSeen });
                }
            }
        }
        return agents;
    },

    async sendToRemoteAgent(fromAgentId, targetInstanceId, targetAgentId, command, waitTime = 60) {
        if (!this.wsConnected) return { error: 'Not connected to relay' };
        const turnId = crypto.randomUUID().slice(0, 8);
        return new Promise((resolve) => {
            const pending = { resolve, responses: [], streamed: {}, completed: 0, expected: 1, timeout: false };
            this.pendingRequests.set(turnId, pending);
            this.sendRemote({ type: 'direct', from: fromAgentId, to: targetAgentId, instanceId: window.AgentMesh?.relayInstanceId, targetInstanceId, turnId, data: { command }, timestamp: Date.now() });
            setTimeout(() => { pending.timeout = true; resolve(pending); this.pendingRequests.delete(turnId); }, waitTime * 1000);
        });
    }
};

export function updateMeshLog() {
    const recent = agentMesh.messageLog.slice(-10).reverse();
    const meshHtml = recent.map(m => {
        const icon = m.type === 'broadcast' ? '📢' : m.type === 'direct' ? '📨' : m.type === 'stream' ? '📡' : m.type === 'turn_end' ? '✅' : '•';
        return `<div style="font-size:10px;color:var(--text-tertiary);margin-bottom:4px;">${icon} ${m.from}${m.to ? '→' + m.to : ''}: ${m.type}</div>`;
    }).join('');
    const meshSection = document.getElementById('meshActivity');
    if (meshSection) meshSection.innerHTML = meshHtml || '<div style="font-size:10px;color:var(--text-tertiary);">No mesh activity</div>';
}
