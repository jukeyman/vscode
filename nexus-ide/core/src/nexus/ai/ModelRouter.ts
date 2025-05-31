import { ModelManager } from './ModelManager';
import { LLMGenerationOptions } from './llms/ILLMProvider';

interface RoutingOptions extends LLMGenerationOptions {
    preferredProvider?: string; // e.g., "openai", "anthropic"
    // model attribute from LLMGenerationOptions can be used for specific model ID
    complexity?: 'low' | 'medium' | 'high';
    // Add other routing hints like 'cost_sensitivity', 'speed_preference', etc.
}

export class ModelRouter {
    constructor(private modelManager: ModelManager) {}

    /**
     * Routes a request to an appropriate LLM based on provided options or internal logic.
     * @param prompt The prompt to send to the LLM.
     * @param taskDescription Optional description of the task, can be used for routing decisions.
     * @param options Optional routing and generation parameters.
     * @returns A promise that resolves to the LLM's response string, or null if an error occurs.
     */
    async routeRequest(
        prompt: string,
        taskDescription?: string,
        options?: RoutingOptions
    ): Promise<string | null> {

        let modelKeyToUse: string | undefined = undefined;

        // 1. Direct routing: If a specific model (alias or ID) is requested in options.model
        if (options?.model) {
            const preferredModelKey = options.model;
            if (this.modelManager.getModelProvider(preferredModelKey)) {
                modelKeyToUse = preferredModelKey;
                console.log(`ModelRouter: Routing to explicitly requested model: ${modelKeyToUse}`);
            } else {
                console.warn(`ModelRouter: Preferred model '${preferredModelKey}' not found. Attempting fallback.`);
            }
        }

        // 2. Provider-based routing (if specific model wasn't found or specified)
        if (!modelKeyToUse && options?.preferredProvider) {
            // This is a simplified approach. A real implementation might look up
            // a default or best model for that provider from settings or a predefined list.
            // For now, we'll assume the user might have registered models like 'openai-default', 'anthropic-default'.
            // Or, it might iterate through all registered models and pick one matching the provider.
            const registeredModels = this.modelManager.listRegisteredModels();
            // Example: find first model that seems to belong to the preferred provider (very naive)
            modelKeyToUse = registeredModels.find(key =>
                key.toLowerCase().includes(options!.preferredProvider!.toLowerCase())
            );
            if (modelKeyToUse) {
                console.log(`ModelRouter: Routing to first available model for preferred provider '${options.preferredProvider}': ${modelKeyToUse}`);
            } else {
                 console.warn(`ModelRouter: No model found for preferred provider '${options.preferredProvider}'. Attempting general fallback.`);
            }
        }

        // 3. Complexity-based routing (example fallback logic)
        if (!modelKeyToUse) {
            const registeredModels = this.modelManager.listRegisteredModels();
            if (options?.complexity === 'high') {
                // Try to find a model typically considered high-capability
                const highTierModels = ['gpt-4', 'claude-3-opus', 'gemini-ultra']; // Example aliases/IDs
                modelKeyToUse = highTierModels.find(m => registeredModels.includes(m)) ||
                                registeredModels.find(m => m.includes('gpt-4') || m.includes('opus') || m.includes('ultra'));
                if(modelKeyToUse) console.log(`ModelRouter: Routing to high complexity model: ${modelKeyToUse}`);
            } else if (options?.complexity === 'medium') {
                const mediumTierModels = ['gpt-3.5-turbo', 'claude-3-sonnet', 'gemini-pro'];
                modelKeyToUse = mediumTierModels.find(m => registeredModels.includes(m)) ||
                                registeredModels.find(m => m.includes('gpt-3.5') || m.includes('sonnet') || m.includes('pro'));
                if(modelKeyToUse) console.log(`ModelRouter: Routing to medium complexity model: ${modelKeyToUse}`);
            } else { // low complexity or undefined
                const lowTierModels = ['claude-3-haiku', 'ollama/llama3', 'llama3']; // Assuming ollama models might be registered with provider prefix
                 modelKeyToUse = lowTierModels.find(m => registeredModels.includes(m)) ||
                                 registeredModels.find(m => m.includes('haiku') || m.includes('ollama') || m.includes('llama3'));
                if(modelKeyToUse) console.log(`ModelRouter: Routing to low complexity/default model: ${modelKeyToUse}`);
            }
        }

        // 4. Absolute fallback (e.g., first registered model or a predefined default)
        if (!modelKeyToUse) {
            const registered = this.modelManager.listRegisteredModels();
            if (registered.length > 0) {
                modelKeyToUse = registered[0]; // Default to the first registered model
                console.log(`ModelRouter: No specific model matched, falling back to first registered model: ${modelKeyToUse}`);
            }
        }

        if (!modelKeyToUse) {
            console.error("ModelRouter: No suitable model found to route the request.");
            return null;
        }

        // Pass through all LLMGenerationOptions from options, including a potentially overriding model.
        // The ModelManager's getCompletion will handle if options.model is different from modelKeyToUse's originally registered model.
        return this.modelManager.getCompletion(modelKeyToUse, prompt, options);
    }
}
```
