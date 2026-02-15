// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPT — Structured turn data, helpers
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
