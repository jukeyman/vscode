import { ILLMProvider, LLMConfig, LLMGenerationOptions } from './llms/ILLMProvider';
import { GPTModel } from './llms/GPTModel';
import { ClaudeModel } from './llms/ClaudeModel';
import { GeminiModel } from './llms/GeminiModel';
import { OllamaModel } from './llms/OllamaModel';

// For VS Code integration (conceptual, actual implementation would use vscode API)
interface VSCodeSettingsProvider {
    getLlmProviderConfigs(): Array<{ provider: string, modelId: string, apiKey?: string, baseUrl?: string, alias?: string }>;
}

export class ModelManager {
    private models: Map<string, ILLMProvider> = new Map();
    private modelConfigs: Map<string, LLMConfig> = new Map(); // Store configs for re-registration or inspection

    constructor(private settingsProvider?: VSCodeSettingsProvider) {
        if (this.settingsProvider) {
            // this.loadModelsFromSettings(); // Conceptual: Call this if settings are ready
        }
    }

    /**
     * Registers an LLM provider instance.
     * @param providerName Name of the provider (e.g., "openai", "anthropic").
     * @param config Configuration for the LLM provider.
     * @param alias Optional alias to register this specific model instance under.
     *              If not provided, modelId from config will be used as the primary key.
     */
    registerModel(providerName: string, config: LLMConfig, alias?: string): boolean {
        let providerInstance: ILLMProvider;
        const key = alias || config.modelId; // Use alias as key if provided, otherwise modelId

        if (this.models.has(key)) {
            console.warn(`ModelManager: Model with key '${key}' is already registered. Re-registering.`);
        }

        try {
            switch (providerName.toLowerCase()) {
                case 'openai':
                    providerInstance = new GPTModel(config);
                    break;
                case 'anthropic':
                    providerInstance = new ClaudeModel(config);
                    break;
                case 'gemini':
                    providerInstance = new GeminiModel(config);
                    break;
                case 'ollama':
                    providerInstance = new OllamaModel(config);
                    break;
                default:
                    console.error(`ModelManager: Unsupported provider name: ${providerName}`);
                    return false;
            }
            this.models.set(key, providerInstance);
            this.modelConfigs.set(key, config); // Store the config too
            console.log(`ModelManager: Registered model '${key}' for provider '${providerName}'.`);
            return true;
        } catch (error) {
            console.error(`ModelManager: Failed to register model '${key}' for provider '${providerName}'. Error: ${error}`);
            return false;
        }
    }

    /**
     * Retrieves an LLM provider instance by its key (alias or modelId).
     * @param modelKey The key (alias or modelId) of the model to retrieve.
     * @returns The ILLMProvider instance or undefined if not found.
     */
    getModelProvider(modelKey: string): ILLMProvider | undefined {
        return this.models.get(modelKey);
    }

    /**
     * Gets a completion from a registered LLM.
     * @param modelKey The key (alias or modelId) of the model to use.
     * @param prompt The prompt to send to the LLM.
     * @param options Optional generation parameters.
     * @returns A promise that resolves to the LLM's response string, or null if an error occurs.
     */
    async getCompletion(modelKey: string, prompt: string, options?: LLMGenerationOptions): Promise<string | null> {
        const provider = this.getModelProvider(modelKey);
        if (!provider) {
            console.error(`ModelManager: Model with key '${modelKey}' not found.`);
            return null;
        }

        try {
            // If options specify a model, it can override the default modelId of the provider instance,
            // assuming the provider's generateResponse handles this.
            const generationOptions = { ...options };
            if (options?.model && this.modelConfigs.get(modelKey)?.modelId !== options.model) {
                // If a different model is specified in options than what this provider instance was configured for,
                // this could be an issue if the API key or endpoint is model-specific for some providers.
                // For now, we pass it through, assuming provider implementations handle it.
                console.warn(`ModelManager: getCompletion for '${modelKey}' called with overriding model option '${options.model}'.`);
            }

            return await provider.generateResponse(prompt, generationOptions);
        } catch (error) {
            console.error(`ModelManager: Error getting completion from model '${modelKey}': ${error}`);
            return null;
        }
    }

    /**
     * Conceptual method to load and register models from VS Code settings.
     * This would typically be called from the extension's activation logic.
     */
    loadModelsFromSettings(): void {
        if (!this.settingsProvider) {
            console.warn("ModelManager: No settings provider configured. Cannot load models from settings.");
            return;
        }

        const providerConfigs = this.settingsProvider.getLlmProviderConfigs();
        if (!providerConfigs || providerConfigs.length === 0) {
            console.log("ModelManager: No LLM providers configured in settings.");
            return;
        }

        console.log(`ModelManager: Loading ${providerConfigs.length} model configurations from settings...`);
        providerConfigs.forEach(cfg => {
            const llmConfig: LLMConfig = {
                modelId: cfg.modelId,
                apiKey: cfg.apiKey, // Assuming apiKey might be retrieved securely by settingsProvider
                baseUrl: cfg.baseUrl,
            };
            this.registerModel(cfg.provider, llmConfig, cfg.alias);
        });
    }

    /**
     * Lists all registered model keys (aliases or model IDs).
     * @returns An array of registered model keys.
     */
    listRegisteredModels(): string[] {
        return Array.from(this.models.keys());
    }

    /**
     * Unregisters a model.
     * @param modelKey The key of the model to unregister.
     */
    unregisterModel(modelKey: string): boolean {
        if (this.models.has(modelKey)) {
            this.models.delete(modelKey);
            this.modelConfigs.delete(modelKey);
            console.log(`ModelManager: Unregistered model '${modelKey}'.`);
            return true;
        }
        console.warn(`ModelManager: Model with key '${modelKey}' not found for unregistration.`);
        return false;
    }
}
```
