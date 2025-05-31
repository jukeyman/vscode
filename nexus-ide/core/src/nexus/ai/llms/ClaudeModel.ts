import axios, { AxiosError } from 'axios';
import { ILLMProvider, LLMConfig, LLMGenerationOptions } from './ILLMProvider';

export class ClaudeModel implements ILLMProvider {
    private config: LLMConfig;
    private readonly API_BASE_URL = 'https://api.anthropic.com/v1';
    private readonly ANTHROPIC_VERSION = '2023-06-01'; // Required header

    constructor(config: LLMConfig) {
        if (!config.apiKey) {
            throw new Error("API key is required for Anthropic ClaudeModel.");
        }
        this.config = config;
    }

    async generateResponse(prompt: string, options?: LLMGenerationOptions): Promise<string> {
        const modelToUse = options?.model || this.config.modelId;
        const endpoint = `${this.API_BASE_URL}/messages`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey!,
            'anthropic-version': this.ANTHROPIC_VERSION,
        };

        const body: Record<string, any> = {
            model: modelToUse,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: options?.maxTokens || 2048, // Anthropic requires max_tokens
            temperature: options?.temperature,
            top_p: options?.topP,
            // stream: options?.stream, // TODO: Implement streaming support
        };

        // Remove undefined options to avoid sending them
        Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);

        try {
            console.log(`ClaudeModel: Sending request to ${endpoint} with model ${modelToUse}`);
            const response = await axios.post(endpoint, body, { headers });

            if (response.data && response.data.content && response.data.content.length > 0 && response.data.content[0].text) {
                return response.data.content[0].text.trim();
            } else {
                console.error("ClaudeModel Error: Invalid response structure from Anthropic API", response.data);
                throw new Error("Invalid response structure from Anthropic API.");
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                console.error("ClaudeModel API Error:", axiosError.response?.status, axiosError.response?.data);
                let errorMsg = `Anthropic API Error: ${axiosError.message}`;
                if (axiosError.response?.data) {
                    errorMsg += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
                }
                throw new Error(errorMsg);
            } else {
                console.error("ClaudeModel Generic Error:", error);
                throw new Error(`An unexpected error occurred while calling Anthropic API: ${String(error)}`);
            }
        }
    }
}
```
