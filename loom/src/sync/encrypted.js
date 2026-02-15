// ═══════════════════════════════════════════════════════════════════════════
// SYNC — encrypted export/import via URL
// ═══════════════════════════════════════════════════════════════════════════

import { state } from '../state/store.js';
import { showToast } from '../ui/toast.js';

async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptData(data, password) {
    const plaintext = JSON.stringify(data);
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0); combined.set(iv, salt.length); combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedBase64, password) {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16), iv = combined.slice(16, 28), ciphertext = combined.slice(28);
    const key = await deriveKey(password, salt);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
}

export function initSyncHandlers() {
    window.exportSyncUrl = async function() {
        const password = document.getElementById('syncExportPassword')?.value;
        if (!password || password.length < 4) { showToast('Password must be 4+ chars'); return; }
        try {
            const data = { anthropic: state.credentials.anthropic, openai: state.credentials.openai, bedrock: state.credentials.bedrock };
            const encrypted = await encryptData(data, password);
            const url = `${window.location.origin}${window.location.pathname}?import=${encrypted}`;
            document.getElementById('syncExportedUrl').value = url;
            document.getElementById('syncExportResult').style.display = 'block';
            showToast('Settings encrypted!');
        } catch (e) { showToast('Export failed: ' + e.message); }
    };

    window.importSyncUrl = async function() {
        const urlOrData = document.getElementById('syncImportUrl')?.value?.trim();
        const password = document.getElementById('syncImportPassword')?.value;
        if (!urlOrData || !password) { showToast('Enter URL and password'); return; }
        try {
            let encryptedData = urlOrData;
            if (urlOrData.includes('?import=')) encryptedData = new URL(urlOrData).searchParams.get('import');
            const data = await decryptData(encryptedData, password);
            if (data.anthropic) state.credentials.anthropic = { ...state.credentials.anthropic, ...data.anthropic };
            if (data.openai) state.credentials.openai = { ...state.credentials.openai, ...data.openai };
            if (data.bedrock) state.credentials.bedrock = { ...state.credentials.bedrock, ...data.bedrock };
            document.getElementById('anthropicKey').value = state.credentials.anthropic.apiKey || '';
            document.getElementById('openaiKey').value = state.credentials.openai.apiKey || '';
            document.getElementById('bedrockKey').value = state.credentials.bedrock.apiKey || '';
            document.getElementById('bedrockRegion').value = state.credentials.bedrock.region || 'us-east-1';
            const { saveState } = await import('./persistence.js');
            saveState();
            showToast('Settings imported!');
            document.getElementById('syncImportUrl').value = '';
            document.getElementById('syncImportPassword').value = '';
        } catch { showToast('Import failed - wrong password?'); }
    };
}

export function checkForImportParam() {
    const url = new URL(window.location.href);
    const importData = url.searchParams.get('import');
    if (importData) {
        window.history.replaceState({}, '', window.location.pathname);
        window.openSettingsModal();
        setTimeout(() => {
            document.querySelector('.tab[onclick*="sync"]')?.click();
            document.getElementById('syncImportUrl').value = window.location.origin + window.location.pathname + '?import=' + importData;
            showToast('Import URL detected - enter password');
        }, 100);
    }
}
