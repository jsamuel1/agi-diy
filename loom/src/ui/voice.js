// ═══════════════════════════════════════════════════════════════════════════
// VOICE — Speech-to-Speech via DevDuck WS (opt-in, with backoff)
// ═══════════════════════════════════════════════════════════════════════════

import { state } from '../state/store.js';
import { showToast } from './toast.js';
import { updateRingUI } from './messages.js';

export const VOICE_PROVIDERS = {
    novasonic: { label: 'Nova Sonic', voices: [{id:'tiffany',label:'Tiffany'},{id:'matthew',label:'Matthew'},{id:'amy',label:'Amy'}] },
    gemini_live: { label: 'Gemini Live', voices: [{id:'Kore',label:'Kore'},{id:'Puck',label:'Puck'},{id:'Charon',label:'Charon'}] },
    openai: { label: 'OpenAI', voices: [{id:'alloy',label:'Alloy'},{id:'echo',label:'Echo'},{id:'shimmer',label:'Shimmer'}] },
};

const V = { active: false, pending: false, audioCtx: null, mediaStream: null, playCtx: null, workletNode: null, workletReady: false, ws: null, micWorklet: null };
let voiceCfg = JSON.parse(localStorage.getItem('kaa-voice-cfg') || '{"provider":"novasonic","voice":"tiffany","enabled":false}');

// Exponential backoff state
let _reconnectDelay = 2000;
let _reconnectTimer = null;
const MAX_RECONNECT_DELAY = 60000;

const AUDIO_WORKLET_CODE = `class AudioProcessor extends AudioWorkletProcessor{constructor(){super();this.buffer=new Float32Array(0);this.port.onmessage=e=>{if(e.data.type==='audio'){const n=new Float32Array(this.buffer.length+e.data.samples.length);n.set(this.buffer);n.set(e.data.samples,this.buffer.length);this.buffer=n}else if(e.data.type==='clear'){this.buffer=new Float32Array(0)}}}process(i,o){const out=o[0][0],n=out.length;if(this.buffer.length>=n){out.set(this.buffer.subarray(0,n));this.buffer=this.buffer.slice(n)}else if(this.buffer.length>0){out.set(this.buffer);for(let i=this.buffer.length;i<n;i++)out[i]=0;this.buffer=new Float32Array(0)}else out.fill(0);return true}}registerProcessor('audio-processor',AudioProcessor);`;
const MIC_WORKLET_CODE = `class MicCaptureProcessor extends AudioWorkletProcessor{constructor(){super();this.active=true;this.port.onmessage=e=>{if(e.data.type==='stop')this.active=false}}process(inputs){if(!this.active)return false;const input=inputs[0]?.[0];if(input?.length>0)this.port.postMessage({type:'audio',samples:new Float32Array(input)});return true}}registerProcessor('mic-capture-processor',MicCaptureProcessor);`;

export function populateVoices() {
    const sel = document.getElementById('voiceSelect'); if (!sel) return;
    const voices = VOICE_PROVIDERS[voiceCfg.provider]?.voices || [];
    sel.innerHTML = voices.map(v => `<option value="${v.id}"${v.id === voiceCfg.voice ? ' selected' : ''}>${v.label}</option>`).join('');
}

function setVoiceUI(s) {
    const btn = document.getElementById('micBtn'), vis = document.getElementById('voiceVis'), cfg = document.getElementById('voiceCfg');
    if (!btn) return;
    if (s === 'active') {
        btn.className = 'mic-btn active'; btn.textContent = '🎤';
        vis.style.display = 'flex'; vis.innerHTML = Array.from({length:16}).map((_,i) => `<div class="bar" style="animation-delay:${i*30}ms"></div>`).join('');
        cfg.style.display = 'flex';
    } else if (s === 'pending') {
        btn.className = 'mic-btn pending'; btn.textContent = '⏳'; vis.style.display = 'none'; cfg.style.display = 'flex';
    } else if (s === 'disconnected') {
        btn.className = 'mic-btn disconnected'; btn.textContent = '🎤'; btn.disabled = false;
        btn.title = 'Voice server not connected — click to retry';
        vis.style.display = 'none'; cfg.style.display = 'flex';
    } else {
        btn.className = 'mic-btn'; btn.textContent = '🎤'; btn.disabled = false;
        vis.style.display = 'none';
        document.getElementById('voiceTranscript').style.display = 'none'; cfg.style.display = 'flex';
    }
}

function showTranscript(text, role) {
    const el = document.getElementById('voiceTranscript'); if (!el) return;
    el.style.display = 'block'; el.className = `voice-transcript ${role}`;
    el.textContent = `${role === 'user' ? '🎤' : '🔊'} ${text}`;
}

async function startAudioCapture() {
    V.audioCtx = new AudioContext({sampleRate: 16000});
    V.mediaStream = await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true}});
    const source = V.audioCtx.createMediaStreamSource(V.mediaStream);
    const blob = new Blob([MIC_WORKLET_CODE], {type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    try { await V.audioCtx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    V.micWorklet = new AudioWorkletNode(V.audioCtx, 'mic-capture-processor');
    let pending = new Float32Array(0);
    V.micWorklet.port.onmessage = (e) => {
        if (e.data.type !== 'audio' || !V.active || !V.ws || V.ws.readyState !== 1) return;
        const merged = new Float32Array(pending.length + e.data.samples.length);
        merged.set(pending); merged.set(e.data.samples, pending.length); pending = merged;
        while (pending.length >= 4096) {
            const chunk = pending.subarray(0, 4096); pending = pending.slice(4096);
            const pcm16 = new Int16Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) pcm16[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32768));
            V.ws.send(JSON.stringify({type:'audio_chunk', audio: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))), sample_rate: 16000}));
        }
    };
    source.connect(V.micWorklet); V.micWorklet.connect(V.audioCtx.destination);
}

function stopAudioCapture() {
    if (V.micWorklet) { V.micWorklet.port.postMessage({type:'stop'}); V.micWorklet.disconnect(); V.micWorklet = null }
    if (V.mediaStream) { V.mediaStream.getTracks().forEach(t => t.stop()); V.mediaStream = null }
    if (V.audioCtx?.state !== 'closed') V.audioCtx?.close().catch(() => {});
    V.audioCtx = null;
}

function stopPlayback() {
    if (V.workletNode) { V.workletNode.disconnect(); V.workletNode = null }
    if (V.playCtx?.state !== 'closed') V.playCtx?.close().catch(() => {});
    V.playCtx = null; V.workletReady = false;
}

async function playAudioChunk(b64, sr) {
    try {
        if (!V.playCtx || V.playCtx.state === 'closed') {
            V.playCtx = new AudioContext({sampleRate: sr});
            const blob = new Blob([AUDIO_WORKLET_CODE], {type:'application/javascript'});
            const url = URL.createObjectURL(blob);
            try { await V.playCtx.audioWorklet.addModule(url); V.workletNode = new AudioWorkletNode(V.playCtx, 'audio-processor'); V.workletNode.connect(V.playCtx.destination); V.workletReady = true } finally { URL.revokeObjectURL(url) }
        }
        if (!V.workletReady || !V.workletNode) return;
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer), float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        V.workletNode.port.postMessage({type:'audio', samples: float32});
    } catch (err) { console.error('Playback error:', err) }
}

function connectVoiceWs() {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

    const ws = new WebSocket('ws://localhost:10001');
    ws.onopen = () => {
        V.ws = ws;
        _reconnectDelay = 2000; // Reset backoff on successful connection
        ws.send(JSON.stringify({ type:'config', voiceProvider: voiceCfg.provider, voice: voiceCfg.voice, bedrockRegion: state.credentials.bedrock?.region || 'us-east-1' }));
        setVoiceUI('idle');
    };
    ws.onmessage = (e) => {
        try { const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'audio_started': V.active = true; V.pending = false; setVoiceUI('active'); showToast('Voice active (' + (msg.provider||'') + ')'); break;
                case 'audio_stopped': V.active = false; V.pending = false; stopAudioCapture(); stopPlayback(); setVoiceUI('idle'); break;
                case 'audio_chunk': playAudioChunk(msg.audio, msg.sample_rate || 16000); break;
                case 'transcript': showTranscript(msg.text, msg.role); if (msg.is_final) { const emoji = msg.role === 'user' ? '🎤' : '🔊'; state.ringBuffer.push({agentId:'voice',role:msg.role,content:emoji+' '+msg.text?.slice(0,150),timestamp:Date.now()}); updateRingUI(); } break;
                case 'interruption': if (V.workletNode) V.workletNode.port.postMessage({type:'clear'}); break;
            }
        } catch (err) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
        V.ws = null;
        if (V.active || V.pending) { V.active = false; V.pending = false; stopAudioCapture(); stopPlayback(); }
        setVoiceUI('disconnected');

        // Only auto-reconnect if voice is enabled
        if (voiceCfg.enabled) {
            _reconnectTimer = setTimeout(connectVoiceWs, _reconnectDelay);
            _reconnectDelay = Math.min(_reconnectDelay * 2, MAX_RECONNECT_DELAY);
        }
    };
}

export async function toggleVoice() {
    // If not connected, enable voice and initiate connection
    if (!V.ws || V.ws.readyState !== 1) {
        voiceCfg.enabled = true;
        localStorage.setItem('kaa-voice-cfg', JSON.stringify(voiceCfg));
        showToast('Connecting to voice server...');
        connectVoiceWs();
        return;
    }

    if (V.active || V.pending) {
        V.active = false; V.pending = false;
        V.ws.send(JSON.stringify({type:'audio_stop'}));
        stopAudioCapture(); stopPlayback(); setVoiceUI('idle');
    } else {
        V.pending = true; setVoiceUI('pending');
        try {
            await startAudioCapture();
            V.ws.send(JSON.stringify({ type:'audio_start', provider: voiceCfg.provider, voice: voiceCfg.voice, bedrockRegion: state.credentials.bedrock?.region || 'us-east-1' }));
        } catch (err) {
            V.pending = false; stopAudioCapture(); setVoiceUI('idle'); showToast('Mic access denied');
        }
    }
}

export function voiceCfgChanged() {
    voiceCfg.provider = document.getElementById('voiceProvider')?.value || 'novasonic';
    populateVoices();
    voiceCfg.voice = document.getElementById('voiceSelect')?.value || '';
    localStorage.setItem('kaa-voice-cfg', JSON.stringify(voiceCfg));
}

export function initVoice() {
    populateVoices();
    const providerEl = document.getElementById('voiceProvider');
    if (providerEl) providerEl.value = voiceCfg.provider;
    populateVoices();
    document.getElementById('voiceCfg').style.display = 'flex';

    if (voiceCfg.enabled) {
        // Previously enabled — try to reconnect
        connectVoiceWs();
    } else {
        // Not enabled — show disconnected state, user must click mic to opt in
        setVoiceUI('disconnected');
    }
}
