// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPT — Structured turn data, helpers, SDK message reconstruction
// ═══════════════════════════════════════════════════════════════════════════

export function transcriptPushText(transcript, text) {
    const last = transcript[transcript.length - 1];
    if (last?.type === 'text') last.content += text;
    else transcript.push({ type: 'text', content: text });
}

export function transcriptFullText(t) {
    return t.filter(e => e.type === 'text').map(e => e.content).join('');
}

export function transcriptLastText(t) {
    return t.findLast(e => e.type === 'text')?.content || '';
}

// ─── Reconstruct SDK messages from stored message history ───
// Converts our stored { role, content, transcript } format into the SDK's
// { role, content: [{ type: 'textBlock' | 'toolUseBlock' | 'toolResultBlock', ... }] }
// format so the agent retains full conversational context after page reload.

export function rebuildSDKMessages(storedMessages) {
    const sdkMessages = [];

    for (const msg of storedMessages) {
        if (msg.role === 'user') {
            sdkMessages.push({
                role: 'user',
                content: [{ type: 'textBlock', text: msg.content }]
            });
            continue;
        }

        if (msg.role !== 'assistant') continue;

        if (!msg.transcript?.length) {
            // No transcript — fall back to plain text
            if (msg.content) {
                sdkMessages.push({
                    role: 'assistant',
                    content: [{ type: 'textBlock', text: msg.content }]
                });
            }
            continue;
        }

        // Walk transcript entries and group them into proper SDK messages:
        // - text + tool_use → assistant message content
        // - tool_result     → user message content (flush preceding assistant first)
        // A new text entry after tool_results starts a new model turn.
        let assistantContent = [];
        let toolResults = [];

        for (const entry of msg.transcript) {
            if (entry.type === 'text') {
                // New text after tool results means a new model turn — flush both
                if (toolResults.length) {
                    if (assistantContent.length)
                        sdkMessages.push({ role: 'assistant', content: assistantContent });
                    sdkMessages.push({ role: 'user', content: toolResults });
                    assistantContent = [];
                    toolResults = [];
                }
                assistantContent.push({ type: 'textBlock', text: entry.content });
            } else if (entry.type === 'tool_use') {
                assistantContent.push({
                    type: 'toolUseBlock',
                    name: entry.name,
                    toolUseId: entry.toolId,
                    input: entry.input || {}
                });
            } else if (entry.type === 'tool_result') {
                const resultText = typeof entry.output === 'string'
                    ? entry.output
                    : JSON.stringify(entry.output || {});
                toolResults.push({
                    type: 'toolResultBlock',
                    toolUseId: entry.toolId,
                    status: entry.status || 'success',
                    content: [{ type: 'textBlock', text: resultText }]
                });
            }
        }

        // Flush remaining
        if (assistantContent.length)
            sdkMessages.push({ role: 'assistant', content: assistantContent });
        if (toolResults.length)
            sdkMessages.push({ role: 'user', content: toolResults });
    }

    return sdkMessages;
}
