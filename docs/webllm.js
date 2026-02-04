/**
 * WebLLM Browser Model - Local LLM running entirely in browser via WebGPU
 * 
 * This provides a Model implementation for the Strands SDK that runs
 * models locally using WebLLM (MLC-AI). No API keys needed - runs on device!
 * 
 * Supported models: https://github.com/mlc-ai/web-llm#available-models
 */

// Import event classes from strands.js for streamAggregated
import { 
    Message,
    TextBlock,
    ToolUseBlock,
    ReasoningBlock,
    ModelMessageStartEvent,
    ModelContentBlockStartEvent,
    ModelContentBlockDeltaEvent,
    ModelContentBlockStopEvent,
    ModelMessageStopEvent,
    ModelMetadataEvent
} from './strands.js';

// Available WebLLM models with tool/function calling support
export const WEBLLM_MODELS = {
    // Recommended for function calling
    HERMES_LLAMA3_8B: 'Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC',
    HERMES_MISTRAL_7B: 'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC',
    
    // Smaller/faster models
    LLAMA_3_8B: 'Llama-3-8B-Instruct-q4f16_1-MLC',
    LLAMA_3_2_3B: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    LLAMA_3_2_1B: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    
    // Qwen models
    QWEN_2_5_7B: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    QWEN_2_5_3B: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    QWEN_2_5_1B: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    
    // Phi models (small but capable)
    PHI_3_5_MINI: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    
    // SmolLM (very small)
    SMOLLM_1_7B: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    SMOLLM_360M: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
};

/**
 * WebLLM Browser Model - runs LLMs locally via WebGPU
 * Implements the Strands Model interface directly
 */
export class WebLLMBrowserModel {
    constructor(config = {}) {
        this._config = {
            modelId: config.modelId || WEBLLM_MODELS.QWEN_2_5_3B,
            temperature: config.temperature || 0.7,
            maxTokens: config.maxTokens || 4096,
            onProgress: config.onProgress || null,
        };
        
        this._engine = null;
        this._loading = false;
        this._loaded = false;
        this._webllm = null;
    }

    updateConfig(config) {
        this._config = { ...this._config, ...config };
    }

    getConfig() {
        return this._config;
    }

    /**
     * Check if WebGPU is supported
     */
    static async isSupported() {
        if (!navigator.gpu) return false;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter !== null;
        } catch {
            return false;
        }
    }

    /**
     * Load the model (must be called before streaming)
     */
    async load() {
        if (this._loaded) return;
        if (this._loading) {
            while (this._loading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return;
        }

        this._loading = true;

        try {
            if (!await WebLLMBrowserModel.isSupported()) {
                throw new Error('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
            }

            if (!this._webllm) {
                this._webllm = await import('https://esm.run/@mlc-ai/web-llm');
            }

            const initProgressCallback = (report) => {
                if (this._config.onProgress) {
                    const percent = Math.round(report.progress * 100);
                    this._config.onProgress(percent, report.text || 'Loading...');
                }
            };

            this._engine = await this._webllm.CreateMLCEngine(this._config.modelId, {
                initProgressCallback
            });

            this._loaded = true;
            console.log(`✅ WebLLM model loaded: ${this._config.modelId}`);

        } catch (error) {
            console.error('Failed to load WebLLM model:', error);
            throw error;
        } finally {
            this._loading = false;
        }
    }

    async unload() {
        if (this._engine) {
            this._engine = null;
            this._loaded = false;
        }
    }

    _buildToolSystemPrompt(toolSpecs) {
        if (!toolSpecs || toolSpecs.length === 0) return '';

        const tools = toolSpecs.map(spec => ({
            type: 'function',
            function: {
                name: spec.name,
                description: spec.description,
                parameters: spec.inputSchema
            }
        }));

        return `You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags. You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions. Here are the available tools: <tools> ${JSON.stringify(tools)} </tools>. Use the following pydantic model json schema for each tool call you will make: {"properties": {"arguments": {"title": "Arguments", "type": "object"}, "name": {"title": "Name", "type": "string"}}, "required": ["arguments", "name"], "title": "FunctionCall", "type": "object"} For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:
<tool_call>
{"arguments": <args-dict>, "name": <function-name>}
</tool_call>`;
    }

    _parseToolCalls(content) {
        if (!content) return [];

        const toolCalls = [];
        const regex = /<tool_call>\s*\n?({[\s\S]*?})\s*\n?<\/tool_call>/g;
        let match;
        let index = 0;

        while ((match = regex.exec(content)) !== null) {
            try {
                const toolData = JSON.parse(match[1].trim());
                toolCalls.push({
                    index: index++,
                    id: `call_${Date.now()}_${index}`,
                    name: toolData.name,
                    arguments: toolData.arguments || {}
                });
            } catch (e) {
                console.warn('Failed to parse tool call:', match[1], e);
            }
        }

        return toolCalls;
    }

    _formatMessages(messages, options) {
        const formatted = [];
        let systemContent = '';
        
        if (options?.toolSpecs && options.toolSpecs.length > 0) {
            systemContent += this._buildToolSystemPrompt(options.toolSpecs);
        }

        if (options?.systemPrompt) {
            const userSystem = typeof options.systemPrompt === 'string'
                ? options.systemPrompt
                : options.systemPrompt.filter(b => b.type === 'textBlock').map(b => b.text).join('\n');
            if (userSystem) {
                systemContent += (systemContent ? '\n\n' : '') + userSystem;
            }
        }

        if (systemContent) {
            formatted.push({ role: 'system', content: systemContent });
        }

        for (const msg of messages) {
            if (msg.role === 'user') {
                const toolResults = msg.content.filter(b => b.type === 'toolResultBlock');
                const otherContent = msg.content.filter(b => b.type !== 'toolResultBlock');

                if (otherContent.length > 0) {
                    const text = otherContent.map(block => {
                        if (block.type === 'textBlock') return block.text;
                        return String(block);
                    }).join('\n');
                    formatted.push({ role: 'user', content: text });
                }

                if (toolResults.length > 0) {
                    const results = toolResults.map(tr => {
                        const content = tr.content.map(c => {
                            if (c.type === 'textBlock') return c.text;
                            if (c.type === 'jsonBlock') return JSON.stringify(c.json);
                            return String(c);
                        }).join('');
                        return tr.status === 'error' ? { error: content } : JSON.parse(content || '{}');
                    });
                    
                    const toolResponse = `<tool_response>\n${JSON.stringify({ results })}\n</tool_response>`;
                    formatted.push({ role: 'user', content: toolResponse });
                }

            } else if (msg.role === 'assistant') {
                const textParts = [];
                const toolUseParts = [];

                for (const block of msg.content) {
                    if (block.type === 'textBlock') {
                        textParts.push(block.text);
                    } else if (block.type === 'toolUseBlock') {
                        toolUseParts.push(`<tool_call>\n${JSON.stringify({
                            name: block.name,
                            arguments: block.input
                        })}\n</tool_call>`);
                    }
                }

                const content = [...textParts, ...toolUseParts].join('\n');
                if (content) {
                    formatted.push({ role: 'assistant', content });
                }
            }
        }

        return formatted;
    }

    /**
     * Stream a conversation - required by Strands SDK
     */
    async *stream(messages, options) {
        if (!this._loaded) {
            await this.load();
        }

        const formattedMessages = this._formatMessages(messages, options);

        yield { type: 'modelMessageStartEvent', role: 'assistant' };

        let fullContent = '';
        let contentBlockStarted = false;

        try {
            const stream = await this._engine.chat.completions.create({
                messages: formattedMessages,
                temperature: this._config.temperature,
                max_tokens: this._config.maxTokens,
                stream: true,
                stream_options: { include_usage: true }
            });

            for await (const chunk of stream) {
                if (!chunk.choices || chunk.choices.length === 0) {
                    if (chunk.usage) {
                        yield {
                            type: 'modelMetadataEvent',
                            usage: {
                                inputTokens: chunk.usage.prompt_tokens || 0,
                                outputTokens: chunk.usage.completion_tokens || 0,
                                totalTokens: chunk.usage.total_tokens || 0
                            }
                        };
                    }
                    continue;
                }

                const choice = chunk.choices[0];
                const delta = choice.delta;

                if (delta?.content) {
                    if (!contentBlockStarted) {
                        contentBlockStarted = true;
                        yield { type: 'modelContentBlockStartEvent' };
                    }

                    fullContent += delta.content;
                    yield {
                        type: 'modelContentBlockDeltaEvent',
                        delta: { type: 'textDelta', text: delta.content }
                    };
                }

                if (choice.finish_reason) {
                    if (contentBlockStarted) {
                        yield { type: 'modelContentBlockStopEvent' };
                        contentBlockStarted = false;
                    }

                    const toolCalls = this._parseToolCalls(fullContent);

                    if (toolCalls.length > 0) {
                        for (const tc of toolCalls) {
                            yield {
                                type: 'modelContentBlockStartEvent',
                                start: {
                                    type: 'toolUseStart',
                                    name: tc.name,
                                    toolUseId: tc.id
                                }
                            };
                            yield {
                                type: 'modelContentBlockDeltaEvent',
                                delta: {
                                    type: 'toolUseInputDelta',
                                    input: JSON.stringify(tc.arguments)
                                }
                            };
                            yield { type: 'modelContentBlockStopEvent' };
                        }

                        yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
                    } else {
                        yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
                    }
                }
            }

        } catch (error) {
            console.error('WebLLM stream error:', error);
            if (contentBlockStarted) {
                yield { type: 'modelContentBlockStopEvent' };
            }
            yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
            throw error;
        }
    }

    /**
     * Convert event data to event class - required for streamAggregated
     */
    _convert_to_class_event(event_data) {
        switch (event_data.type) {
            case 'modelMessageStartEvent':
                return new ModelMessageStartEvent(event_data);
            case 'modelContentBlockStartEvent':
                return new ModelContentBlockStartEvent(event_data);
            case 'modelContentBlockDeltaEvent':
                return new ModelContentBlockDeltaEvent(event_data);
            case 'modelContentBlockStopEvent':
                return new ModelContentBlockStopEvent(event_data);
            case 'modelMessageStopEvent':
                return new ModelMessageStopEvent(event_data);
            case 'modelMetadataEvent':
                return new ModelMetadataEvent(event_data);
            default:
                throw new Error(`Unsupported event type: ${event_data.type}`);
        }
    }

    /**
     * Stream with aggregation - required by Strands Agent
     * This method aggregates streaming events into complete messages
     */
    async *streamAggregated(messages, options) {
        let messageRole = null;
        const contentBlocks = [];
        let accumulatedText = '';
        let accumulatedToolInput = '';
        let toolName = '';
        let toolUseId = '';
        let stoppedMessage = null;
        let finalStopReason = null;
        let metadata = undefined;

        for await (const event_data of this.stream(messages, options)) {
            const event = this._convert_to_class_event(event_data);
            yield event;

            switch (event.type) {
                case 'modelMessageStartEvent':
                    messageRole = event.role;
                    contentBlocks.length = 0;
                    break;

                case 'modelContentBlockStartEvent':
                    if (event.start?.type === 'toolUseStart') {
                        toolName = event.start.name;
                        toolUseId = event.start.toolUseId;
                    }
                    accumulatedToolInput = '';
                    accumulatedText = '';
                    break;

                case 'modelContentBlockDeltaEvent':
                    if (event.delta.type === 'textDelta') {
                        accumulatedText += event.delta.text;
                    } else if (event.delta.type === 'toolUseInputDelta') {
                        accumulatedToolInput += event.delta.input;
                    }
                    break;

                case 'modelContentBlockStopEvent': {
                    let block;
                    if (toolUseId) {
                        block = new ToolUseBlock({
                            name: toolName,
                            toolUseId: toolUseId,
                            input: accumulatedToolInput ? JSON.parse(accumulatedToolInput) : {}
                        });
                        toolUseId = '';
                        toolName = '';
                    } else if (accumulatedText) {
                        block = new TextBlock(accumulatedText);
                    }
                    if (block) {
                        contentBlocks.push(block);
                        yield block;
                    }
                    break;
                }

                case 'modelMessageStopEvent':
                    if (messageRole) {
                        stoppedMessage = new Message({
                            role: messageRole,
                            content: [...contentBlocks]
                        });
                        finalStopReason = event.stopReason;
                    }
                    break;

                case 'modelMetadataEvent':
                    metadata = event;
                    break;
            }
        }

        if (!stoppedMessage || !finalStopReason) {
            throw new Error('Stream ended without completing a message');
        }

        const result = {
            message: stoppedMessage,
            stopReason: finalStopReason
        };
        if (metadata !== undefined) {
            result.metadata = metadata;
        }
        return result;
    }
}

export default WebLLMBrowserModel;
