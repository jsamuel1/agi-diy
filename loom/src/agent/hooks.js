// ═══════════════════════════════════════════════════════════════════════════
// HOOKS — InterruptHook, SummarizingManager
// ═══════════════════════════════════════════════════════════════════════════

import { BeforeModelCallEvent, AfterInvocationEvent, SlidingWindowConversationManager } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { addMessageToUI } from '../ui/messages.js';

export const interruptQueues = new Map(); // agentId -> [message strings]

export function queueInterrupt(agentId, message) {
    if (!interruptQueues.has(agentId)) interruptQueues.set(agentId, []);
    interruptQueues.get(agentId).push(message);
}

export class InterruptHook {
    registerCallbacks(registry) {
        registry.addCallback(BeforeModelCallEvent, (event) => {
            const agentId = state.activeAgentId || 'main';
            const queue = interruptQueues.get(agentId);
            if (queue?.length) {
                const msgs = queue.splice(0);
                const injected = msgs.map(m => `[USER INTERRUPT]: ${m}`).join('\n');
                event.agent.messages.push({ role: 'user', content: [{ type: 'textBlock', text: injected }] });
                addMessageToUI('system', `💬 Interrupt injected: ${msgs.length} message(s)`, agentId);
            }
        });
    }
}

export class SummarizingManager {
    constructor({ windowSize = 40, summarizeAfter = 30 } = {}) {
        this.inner = new SlidingWindowConversationManager({ windowSize });
        this.summarizeAfter = summarizeAfter;
        this.summaries = new Map();
    }
    registerCallbacks(registry) {
        this.inner.registerCallbacks(registry);
        registry.addCallback(AfterInvocationEvent, async (event) => {
            const msgs = event.agent.messages;
            if (msgs.length < this.summarizeAfter) return;
            const agentId = state.activeAgentId || 'main';
            const half = Math.floor(msgs.length / 2);
            const toSummarize = msgs.slice(0, half);
            const texts = toSummarize.map(m => {
                const c = m.content || m;
                if (typeof c === 'string') return c;
                if (Array.isArray(c)) return c.map(b => b.text || '').join(' ');
                return '';
            }).filter(Boolean).join('\n');
            if (texts.length < 200) return;
            const summary = `[CONVERSATION SUMMARY]: ${texts.slice(0, 2000)}...`;
            this.summaries.set(agentId, summary);
            const kept = msgs.slice(half);
            event.agent.messages.length = 0;
            event.agent.messages.push({ role: 'user', content: [{ type: 'textBlock', text: summary }] });
            kept.forEach(m => event.agent.messages.push(m));
            console.log(`Summarized ${half} messages for ${agentId}, kept ${kept.length}`);
        });
    }
}
