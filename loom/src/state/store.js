// ═══════════════════════════════════════════════════════════════════════════
// STATE — App state, constants, config
// ═══════════════════════════════════════════════════════════════════════════

export const state = {
    agents: new Map(),          // agentId -> { agent, model, config, messages, status }
    activeAgentId: null,
    ringBuffer: [],             // Shared context
    schedules: new Map(),       // scheduleId -> { name, agentId, prompt, type, cron/delay, timer }
    subscriptions: null,        // topic subscriptions (lazy init)
    credentials: {
        anthropic: { apiKey: '', model: 'claude-opus-4-6' },
        openai: { apiKey: '', model: 'gpt-5.2-2025-12-11' },
        bedrock: { apiKey: '', region: 'us-east-1', model: 'global.anthropic.claude-opus-4-6-v1' },
        openai_compatible: { apiKey: '', baseUrl: '', model: '' },
        webllm: { model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' },
        github: { token: '' }
    },
    agentColors: ['#00ff88', '#00aaff', '#ff88ff', '#ffaa00', '#ff6666', '#88ffff'],
    colorIndex: 0
};

// Pipeline task colors
export const TASK_COLORS = {
    requirements: '#00ff88', planning: '#9966ff', coding: '#ff8800',
    testing: '#00cccc', review: '#00ff88', pr: '#00ff88',
    docs: '#00ff88', custom: '#ffaa00'
};

// Default models per provider
export const DEFAULT_MODELS = {
    bedrock: 'global.anthropic.claude-opus-4-6-v1',
    anthropic: 'claude-opus-4-6',
    openai: 'gpt-5.2-2025-12-11',
    openai_compatible: '',
    webllm: 'Qwen2.5-3B-Instruct-q4f16_1-MLC'
};

// Model catalog: autocomplete + per-model feature flags
export const MODEL_CATALOG = {
    bedrock: [
        { id: 'global.anthropic.claude-opus-4-6-v1', name: 'Opus 4.6 (Global)', flags: { thinking: { type: 'adaptive' } } },
        { id: 'us.anthropic.claude-opus-4-6-v1', name: 'Opus 4.6 (US)', flags: { thinking: { type: 'adaptive' } } },
        { id: 'eu.anthropic.claude-opus-4-6-v1', name: 'Opus 4.6 (EU)', flags: { thinking: { type: 'adaptive' } } },
        { id: 'apac.anthropic.claude-opus-4-6-v1', name: 'Opus 4.6 (APAC)', flags: { thinking: { type: 'adaptive' } } },
        { id: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Sonnet 4.5 (Global)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Sonnet 4.5 (US)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Sonnet 4.5 (EU)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'apac.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Sonnet 4.5 (APAC)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'global.anthropic.claude-sonnet-4-20250514-v1:0', name: 'Sonnet 4 (Global)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', name: 'Sonnet 4 (US)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'eu.anthropic.claude-sonnet-4-20250514-v1:0', name: 'Sonnet 4 (EU)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'apac.anthropic.claude-sonnet-4-20250514-v1:0', name: 'Sonnet 4 (APAC)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'global.anthropic.claude-opus-4-5-20251101-v1:0', name: 'Opus 4.5 (Global)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'us.anthropic.claude-opus-4-5-20251101-v1:0', name: 'Opus 4.5 (US)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'global.anthropic.claude-opus-4-20250514-v1:0', name: 'Opus 4 (Global)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'us.anthropic.claude-opus-4-20250514-v1:0', name: 'Opus 4 (US)', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Haiku 4.5 (Global)', flags: { thinking: { type: 'enabled', budget_tokens: 5000 } } },
        { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Haiku 4.5 (US)', flags: { thinking: { type: 'enabled', budget_tokens: 5000 } } },
    ],
    anthropic: [
        { id: 'claude-opus-4-6', name: 'Opus 4.6', flags: { thinking: { type: 'adaptive' } } },
        { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'claude-sonnet-4-20250514', name: 'Sonnet 4', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'claude-opus-4-20250514', name: 'Opus 4', flags: { thinking: { type: 'enabled', budget_tokens: 10000 } } },
        { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', flags: { thinking: { type: 'enabled', budget_tokens: 5000 } } },
    ],
    openai: [
        { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2' },
        { id: 'gpt-5-2025-04-14', name: 'GPT-5' },
        { id: 'o3-2025-04-16', name: 'o3 (Reasoning)' },
        { id: 'o4-mini-2025-04-16', name: 'o4-mini (Reasoning)' },
        { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1' },
    ]
};

// Default additional request fields for bedrock (extended thinking)
export const DEFAULT_BEDROCK_ADDITIONAL_FIELDS = {
    thinking: { type: 'adaptive' }
};

export const DEFAULT_MAX_TOKENS = 60000;

// Tool groups for spawn/edit modals
export const TOOL_GROUPS = {
    core: ['render_ui','javascript_eval','storage_get','storage_set','fetch_url','notify','update_self','create_tool','list_tools','delete_tool'],
    sandbox: ['sandbox_create','sandbox_update','sandbox_read','sandbox_list','sandbox_delete'],
    pipeline: ['create_pipeline','read_pipeline','add_task','update_task_status','update_task_deps','complete_pipeline','emit_status'],
    agents: ['use_agent','scheduler','invoke_agent','broadcast_to_agents','list_agents','invoke_remote_agent','subscribe_topic','publish_topic'],
    github: ['github_search','github_read_file','github_list_repos','github_create_issue','github_list_issues','github_create_pr','github_read_pr']
};
