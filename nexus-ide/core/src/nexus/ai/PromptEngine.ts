import { ContextProcessor } from './ContextProcessor'; // Assuming ContextProcessor.ts is in the same directory

interface PromptTemplate {
    id: string;
    content: string; // The template string with placeholders like {{variable_name}}
    description?: string;
    requiredVariables?: string[];
}

export class PromptEngine {
    private promptTemplates: Map<string, PromptTemplate> = new Map();

    constructor(private contextProcessor: ContextProcessor) {
        // Load default/mock templates for now
        this.loadMockTemplates();
    }

    private loadMockTemplates(): void {
        const mockTemplates: PromptTemplate[] = [
            {
                id: 'summarize_text',
                content: "Please summarize the following text:\n\n{{text_to_summarize}}\n\nSummary:",
                description: "A template to summarize a given piece of text.",
                requiredVariables: ['text_to_summarize']
            },
            {
                id: 'code_explanation',
                content: "Explain the following {{language}} code snippet:\n\n```{{language}}\n{{code_snippet}}\n```\n\nExplanation:",
                description: "A template to explain a code snippet.",
                requiredVariables: ['language', 'code_snippet']
            },
            {
                id: 'general_query_with_context',
                content: "Context:\n{{system_context}}\n\nUser Query: {{user_query}}\n\nResponse:",
                description: "A general query template that includes system context.",
                requiredVariables: ['system_context', 'user_query']
            }
        ];
        mockTemplates.forEach(template => this.promptTemplates.set(template.id, template));
        console.log("PromptEngine: Mock templates loaded.");
    }

    /**
     * Loads prompt templates from a specified directory (conceptual for now).
     * In a real implementation, this would read files (e.g., .md or .txt)
     * and parse them into PromptTemplate objects.
     * @param directoryPath The path to the directory containing prompt template files.
     */
    async loadPromptTemplates(directoryPath: string): Promise<void> {
        console.warn(`PromptEngine: loadPromptTemplates from directory '${directoryPath}' is not implemented yet. Using mock templates.`);
        // TODO: Implement file system loading and parsing of templates.
        // For example, read all .md files, use frontmatter for metadata (id, description, requiredVariables)
        // and file content for the template string.
    }
    
    /**
     * Registers a new prompt template or overwrites an existing one.
     * @param template The PromptTemplate object to register.
     */
    registerPromptTemplate(template: PromptTemplate): void {
        if (!template.id || !template.content) {
            console.error("PromptEngine: Template ID and content are required for registration.");
            return;
        }
        this.promptTemplates.set(template.id, template);
        console.log(`PromptEngine: Template '${template.id}' registered.`);
    }


    /**
     * Crafts a final prompt string by loading a template (if templateNameOrRaw is a known ID),
     * replacing placeholders with contextVariables, integrating an optional userQuery,
     * and then injecting further context using the ContextProcessor.
     * 
     * @param templateNameOrRaw Either the ID of a registered prompt template or the raw template string itself.
     * @param contextVariables A record of key-value pairs to replace placeholders in the template.
     * @param userQuery An optional user query to be appended or integrated into the prompt.
     * @returns A promise that resolves to the final, processed prompt string.
     */
    async craftPrompt(
        templateNameOrRaw: string,
        contextVariables: Record<string, any>,
        userQuery?: string
    ): Promise<string> {
        let rawPromptString: string;
        const template = this.promptTemplates.get(templateNameOrRaw);

        if (template) {
            rawPromptString = template.content;
            // Basic validation for required variables if defined in template
            if (template.requiredVariables) {
                for (const reqVar of template.requiredVariables) {
                    if (!(reqVar in contextVariables)) {
                        console.warn(`PromptEngine: Missing required variable '${reqVar}' for template '${template.id}'.`);
                        // Decide on error handling: throw error, return empty, or proceed? For now, proceed.
                    }
                }
            }
        } else {
            // Assume templateNameOrRaw is the actual template string
            rawPromptString = templateNameOrRaw;
        }

        // Replace placeholders (e.g., {{variable_name}})
        let processedPrompt = rawPromptString.replace(/\{\{(\w+)\}\}/g, (match, variableName) => {
            return contextVariables.hasOwnProperty(variableName) ? String(contextVariables[variableName]) : match;
        });

        // Integrate userQuery if provided
        // This is a simple append; more sophisticated integration might be needed depending on template structure
        if (userQuery) {
            if (processedPrompt.includes('{{user_query}}')) { // If template has a specific placeholder for user query
                 processedPrompt = processedPrompt.replace('{{user_query}}', userQuery);
            } else { // Append otherwise
                processedPrompt += `\n\nUser Query: ${userQuery}`; 
            }
        }
        
        // Inject further context using ContextProcessor (currently a stub)
        // The contextConfig for injectContext might come from template metadata or be passed in.
        const finalPrompt = await this.contextProcessor.injectContext(processedPrompt, {
            // Example contextConfig, could be more dynamic
            retrieval_needed: template?.id === 'general_query_with_context', 
            max_context_tokens: 2000 
        });

        console.log(`PromptEngine: Crafted final prompt for template/raw: '${templateNameOrRaw.substring(0,50)}...'`);
        return finalPrompt;
    }
}
```
