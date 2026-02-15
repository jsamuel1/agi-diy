// ═══════════════════════════════════════════════════════════════════════════
// MODEL PROVIDERS — createModel, detectProvider, providerReady, getModelFlags
// ═══════════════════════════════════════════════════════════════════════════

import { AnthropicModel, OpenAIModel, BedrockModel } from '../vendor/strands.js';
import { WebLLMBrowserModel } from '../vendor/webllm.js';
import { createModel as _createModel, detectProvider as _detectProvider } from '../vendor/model-utils.js';
import { state, DEFAULT_MODELS, DEFAULT_BEDROCK_ADDITIONAL_FIELDS, DEFAULT_MAX_TOKENS, MODEL_CATALOG } from '../state/store.js';

let webllmModelInstance = null;
const _models = { AnthropicModel, OpenAIModel, BedrockModel, WebLLMBrowserModel };

export const PROVIDER_CAPS = {
    bedrock:           { needsApiKey: true,  needsBaseUrl: false, additionalFields: true  },
    anthropic:         { needsApiKey: true,  needsBaseUrl: false, additionalFields: true  },
    openai:            { needsApiKey: true,  needsBaseUrl: false, additionalFields: false },
    openai_compatible: { needsApiKey: false, needsBaseUrl: true,  additionalFields: false },
    webllm:            { needsApiKey: false, needsBaseUrl: false, additionalFields: false },
};

export function detectProvider() {
    return _detectProvider(state.credentials);
}

export function providerReady(provider) {
    const caps = PROVIDER_CAPS[provider];
    if (!caps) return false;
    const c = state.credentials[provider];
    if (caps.needsApiKey && !c?.apiKey) return false;
    if (caps.needsBaseUrl && !c?.baseUrl) return false;
    return true;
}

export function createModel(provider, customConfig = {}) {
    const modelId = customConfig.modelId || state.credentials[provider]?.model || DEFAULT_MODELS[provider];
    const catalogFlags = getModelFlags(provider, modelId);
    const additionalFields = customConfig.additionalRequestFields ?? catalogFlags ?? (provider === 'bedrock' ? DEFAULT_BEDROCK_ADDITIONAL_FIELDS : null);

    // WebLLM caching
    if (provider === 'webllm') {
        if (webllmModelInstance?.getConfig().modelId === modelId && webllmModelInstance._loaded) return webllmModelInstance;
        const progressEl = document.getElementById('webllmProgress');
        const m = _createModel(provider, state.credentials, _models, {
            modelId, maxTokens: customConfig.maxTokens || 4096,
            onProgress: (pct, txt) => { if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = `${txt || 'Loading'} ${pct}%`; } }
        });
        webllmModelInstance = m;
        return m;
    }

    return _createModel(provider, state.credentials, _models, {
        modelId, maxTokens: customConfig.maxTokens || DEFAULT_MAX_TOKENS, additionalRequestFields: additionalFields
    });
}

export function getModelFlags(provider, modelId) {
    return (MODEL_CATALOG[provider] || []).find(m => m.id === modelId)?.flags || null;
}

export function updateModelDatalist(provider, datalistId) {
    let dl = document.getElementById(datalistId);
    if (!dl) { dl = document.createElement('datalist'); dl.id = datalistId; document.body.appendChild(dl); }
    dl.innerHTML = (MODEL_CATALOG[provider] || []).map(m => `<option value="${m.id}" label="${m.name}">`).join('');
}
