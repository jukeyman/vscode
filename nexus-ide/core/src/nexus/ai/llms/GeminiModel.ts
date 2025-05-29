import axios, { AxiosError } from 'axios';
import { ILLMProvider, LLMConfig, LLMGenerationOptions } from './ILLMProvider';

export class GeminiModel implements ILLMProvider {
    private config: LLMConfig;
    private readonly API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

    constructor(config: LLMConfig) {
        if (!config.apiKey) {
            throw new Error("API key is required for Google GeminiModel.");
        }
        this.config = config;
    }

    async generateResponse(prompt: string, options?: LLMGenerationOptions): Promise<string> {
        const modelToUse = options?.model || this.config.modelId;
        const endpoint = `${this.API_BASE_URL}/${modelToUse}:generateContent?key=${this.config.apiKey}`;
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        // Constructing the request body according to Gemini API structure
        const body: Record<string, any> = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: { // Optional: map LLMGenerationOptions to Gemini's generationConfig
                temperature: options?.temperature,
                topP: options?.topP,
                maxOutputTokens: options?.maxTokens,
                // candidateCount: 1, // Default, can be made configurable
                // stopSequences: options?.stop // if options.stop is an array of strings
            }
        };
        
        // Remove undefined generationConfig options
        if (body.generationConfig) {
            Object.keys(body.generationConfig).forEach(key => 
                body.generationConfig[key] === undefined && delete body.generationConfig[key]
            );
            if (Object.keys(body.generationConfig).length === 0) {
                delete body.generationConfig;
            }
        }


        try {
            console.log(`GeminiModel: Sending request to ${modelToUse}`);
            const response = await axios.post(endpoint, body, { headers });

            if (response.data && response.data.candidates && response.data.candidates.length > 0 &&
                response.data.candidates[0].content && response.data.candidates[0].content.parts &&
                response.data.candidates[0].content.parts.length > 0 && response.data.candidates[0].content.parts[0].text) {
                return response.data.candidates[0].content.parts[0].text.trim();
            } else if (response.data && response.data.promptFeedback && response.data.promptFeedback.blockReason) {
                // Handle cases where the prompt was blocked
                const blockReason = response.data.promptFeedback.blockReason;
                const safetyRatings = response.data.promptFeedback.safetyRatings || [];
                console.error(`GeminiModel Error: Prompt blocked due to ${blockReason}. Safety ratings: ${JSON.stringify(safetyRatings)}`);
                throw new Error(`Prompt blocked by Gemini API due to: ${blockReason}.`);
            }
            else {
                console.error("GeminiModel Error: Invalid response structure from Google AI API", response.data);
                throw new Error("Invalid response structure from Google AI API.");
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                console.error("GeminiModel API Error:", axiosError.response?.status, axiosError.response?.data);
                let errorMsg = `Google AI API Error: ${axiosError.message}`;
                if (axiosError.response?.data) {
                    errorMsg += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
                }
                throw new Error(errorMsg);
            } else {
                console.error("GeminiModel Generic Error:", error);
                throw new Error(`An unexpected error occurred while calling Google AI API: ${String(error)}`);
            }
        }
    }
}
```
