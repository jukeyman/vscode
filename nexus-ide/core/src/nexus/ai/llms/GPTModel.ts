import axios, { AxiosError } from 'axios';
import { ILLMProvider, LLMConfig, LLMGenerationOptions } from './ILLMProvider';

export class GPTModel implements ILLMProvider {
    private config: LLMConfig;
    private readonly API_BASE_URL = 'https://api.openai.com/v1';

    constructor(config: LLMConfig) {
        if (!config.apiKey) {
            throw new Error("API key is required for OpenAI GPTModel.");
        }
        this.config = config;
    }

    async generateResponse(prompt: string, options?: LLMGenerationOptions): Promise<string> {
        const modelToUse = options?.model || this.config.modelId;
        const endpoint = `${this.API_BASE_URL}/chat/completions`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
        };

        const body: Record<string, any> = {
            model: modelToUse,
            messages: [{ role: 'user', content: prompt }],
            temperature: options?.temperature,
            max_tokens: options?.maxTokens,
            top_p: options?.topP,
            // stream: options?.stream, // TODO: Implement streaming support
        };

        // Remove undefined options to avoid sending them in the request body
        Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);

        try {
            console.log(`GPTModel: Sending request to ${endpoint} with model ${modelToUse}`);
            const response = await axios.post(endpoint, body, { headers });

            if (response.data && response.data.choices && response.data.choices.length > 0 && response.data.choices[0].message) {
                return response.data.choices[0].message.content?.trim() || "";
            } else {
                console.error("GPTModel Error: Invalid response structure from OpenAI API", response.data);
                throw new Error("Invalid response structure from OpenAI API.");
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                console.error("GPTModel API Error:", axiosError.response?.status, axiosError.response?.data);
                let errorMsg = `OpenAI API Error: ${axiosError.message}`;
                if (axiosError.response?.data) {
                    errorMsg += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
                }
                throw new Error(errorMsg);
            } else {
                console.error("GPTModel Generic Error:", error);
                throw new Error(`An unexpected error occurred while calling OpenAI API: ${String(error)}`);
            }
        }
    }
}
```
