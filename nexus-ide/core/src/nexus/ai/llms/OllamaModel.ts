import axios, { AxiosError } from 'axios';
import { ILLMProvider, LLMConfig, LLMGenerationOptions } from './ILLMProvider';

export class OllamaModel implements ILLMProvider {
    private config: LLMConfig;
    private readonly DEFAULT_BASE_URL = 'http://localhost:11434';

    constructor(config: LLMConfig) {
        this.config = {
            ...config,
            baseUrl: config.baseUrl || this.DEFAULT_BASE_URL,
        };
    }

    async generateResponse(prompt: string, options?: LLMGenerationOptions): Promise<string> {
        const modelToUse = options?.model || this.config.modelId;
        // Ollama has different endpoints for chat completions vs. raw generation.
        // We'll assume chat endpoint for now as it's more common for user interaction.
        // Use /api/generate for raw completions if needed.
        const endpoint = `${this.config.baseUrl}/api/chat`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const body: Record<string, any> = {
            model: modelToUse,
            messages: [{ role: 'user', content: prompt }],
            stream: false, // Explicitly set stream to false for non-streaming response
            options: { // Ollama specific options can go here
                temperature: options?.temperature,
                top_p: options?.topP,
                num_predict: options?.maxTokens, // Ollama uses num_predict for max tokens
                // seed: options?.seed, // if you add seed to LLMGenerationOptions
                // stop: options?.stop_sequences // if you add stop_sequences
            }
        };

        // Remove undefined options from the 'options' sub-object
        if (body.options) {
            Object.keys(body.options).forEach(key => body.options[key] === undefined && delete body.options[key]);
            if (Object.keys(body.options).length === 0) {
                delete body.options;
            }
        }

        try {
            console.log(`OllamaModel: Sending request to ${endpoint} with model ${modelToUse}`);
            const response = await axios.post(endpoint, body, { headers });

            // For /api/chat (non-streaming)
            if (response.data && response.data.message && response.data.message.content) {
                return response.data.message.content.trim();
            }
            // Fallback for /api/generate (non-streaming, if endpoint was changed)
            else if (response.data && response.data.response) {
                return response.data.response.trim();
            }
            else {
                console.error("OllamaModel Error: Invalid response structure from Ollama API", response.data);
                throw new Error("Invalid response structure from Ollama API.");
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                console.error("OllamaModel API Error:", axiosError.response?.status, axiosError.response?.data, axiosError.config);
                let errorMsg = `Ollama API Error: ${axiosError.message}. Endpoint: ${endpoint}`;
                if (axiosError.response?.data) {
                    errorMsg += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
                } else if (axiosError.code === 'ECONNREFUSED') {
                    errorMsg = `Ollama API Error: Connection refused at ${this.config.baseUrl}. Ensure Ollama is running.`;
                }
                throw new Error(errorMsg);
            } else {
                console.error("OllamaModel Generic Error:", error);
                throw new Error(`An unexpected error occurred while calling Ollama API: ${String(error)}`);
            }
        }
    }
}
```
