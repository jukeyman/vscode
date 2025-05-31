export interface LLMGenerationOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    model?: string; // Can override the default model of the provider instance
    stream?: boolean; // For future streaming support
    // Add other common options like stop_sequences, presence_penalty, frequency_penalty if needed
    [key: string]: any; // Allow other provider-specific options
}

export interface LLMConfig {
    apiKey?: string; // Optional for providers like Ollama or self-hosted
    modelId: string; // e.g., "gpt-4", "claude-3-opus-20240229", "llama3"
    baseUrl?: string; // e.g., for Ollama or other self-hosted endpoints
    // Add other provider-specific config keys as needed
    [key: string]: any;
}

export interface ILLMProvider {
    /**
     * Generates a response from the LLM based on the given prompt and options.
     * @param prompt The input prompt string for the LLM.
     * @param options Optional parameters for generation, like temperature, maxTokens, etc.
     * @returns A promise that resolves to the LLM's generated text response.
     */
    generateResponse(prompt: string, options?: LLMGenerationOptions): Promise<string>;
}
```
