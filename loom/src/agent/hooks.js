// ═══════════════════════════════════════════════════════════════════════════
// HOOKS — InterruptHook, RetryHook
// ═══════════════════════════════════════════════════════════════════════════

import { BeforeModelCallEvent, AfterModelCallEvent } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { addMessageToUI } from '../ui/messages.js';
import { appendActivityFeed } from '../ui/activity.js';

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

// ─── RetryHook — exponential backoff for transient API errors ───

const RETRYABLE_NAMES = new Set([
    'ModelThrottledError',
    'RateLimitError',
    'APIConnectionError',
    'APIConnectionTimeoutError',
    'InternalServerError',
]);

const RETRYABLE_PATTERNS = /throttl|rate.limit|overloaded|too many requests|service.unavailable|502|503|504/i;

function isRetryable(error) {
    if (RETRYABLE_NAMES.has(error.name)) return true;
    const status = error.status || error.statusCode;
    if (status === 429 || (status >= 500 && status < 600)) return true;
    if (RETRYABLE_PATTERNS.test(error.message || '')) return true;
    return false;
}

export class RetryHook {
    constructor({ maxRetries = 3, baseDelayMs = 1000 } = {}) {
        this._maxRetries = maxRetries;
        this._baseDelayMs = baseDelayMs;
        this._retries = 0;
    }

    registerCallbacks(registry) {
        registry.addCallback(AfterModelCallEvent, async (event) => {
            // Reset counter on success
            if (!event.error) {
                this._retries = 0;
                return;
            }

            if (!isRetryable(event.error)) return;
            if (this._retries >= this._maxRetries) {
                this._retries = 0;
                return; // Exhausted — let it fail
            }

            this._retries++;
            const delay = this._baseDelayMs * Math.pow(2, this._retries - 1)
                + Math.floor(Math.random() * 500);

            const agentId = state.activeAgentId || 'main';
            const reason = event.error.name || `HTTP ${event.error.status || '?'}`;
            const msg = `Retry ${this._retries}/${this._maxRetries} (${reason}), waiting ${(delay / 1000).toFixed(1)}s...`;
            console.warn(`[loom] ${agentId}: ${msg}`);
            appendActivityFeed(agentId, `⟳ ${msg}`, 'msg');
            addMessageToUI('system', msg, agentId);

            await new Promise(r => setTimeout(r, delay));
            event.retry = true;
        });
    }
}
