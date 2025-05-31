import * as fs from 'fs/promises'; // Use promise-based fs
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv, { Schema } from 'ajv'; // Import Schema type for Ajv
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext'; // Adjusted path
import { ModelRouter } from '../../ai/ModelRouter'; // Adjusted path
// import { PromptEngine } from '../../ai/PromptEngine'; // Not used in this version, but could be future enhancement

// Declare vscode for type-checking, actual vscode module is available in extension runtime
declare var vscode: any;

export class ArchitectAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';
    private blueprintSchema: Schema | null = null; // Store the loaded JSON schema

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "ArchitectAgent",
            description: "Designs system architectures and generates system blueprints based on high-level requirements using LLMs.",
            capabilities: [
                "system_design",
                "blueprint_generation_llm",
                "technology_stack_selection",
                "data_modeling_conceptual",
                "api_design_conceptual"
            ],
            tools: ["LLMModelRouterTool"], // Conceptual tool representing modelRouter
            defaultModelId: "gpt-4-architecture-optimized", // Example default model this agent prefers
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("ArchitectAgent instance created.");
        // Initialization of metaPromptContent and blueprintSchema is moved to an async initialize method
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> { // Pass extensionUri for robust pathing
        this.log("Initializing ArchitectAgent: Loading meta-prompt and blueprint schema...");
        try {
            let metaPromptPath: string;
            let schemaPath: string;

            if (extensionUri) { // If running in VS Code extension context
                metaPromptPath = path.join(extensionUri.fsPath, 'out', 'nexus', 'agents', 'prompts', 'architect_blueprint_metaprompt.md');
                // Assuming schemas are copied to a 'schemas' dir in 'out' during build, or use a direct relative path from src
                // For simplicity, let's assume it's also packaged in 'out' or accessible via a relative path from source
                // This path needs to correctly point to where system-blueprint.schema.json is accessible at runtime.
                // A common pattern is to copy such assets to the 'out' directory during build.
                // For this example, let's assume it's copied to 'out/schemas'
                schemaPath = path.join(extensionUri.fsPath, 'out', 'schemas', 'system-blueprint.schema.json');

                // Fallback for development if not found in 'out' (e.g. running tests or direct ts-node)
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                     metaPromptPath = path.join(__dirname, '../prompts/architect_blueprint_metaprompt.md');
                }
                if (!await fs.stat(schemaPath).then(() => true).catch(() => false)) {
                     // This path assumes 'schemas' is a sibling to 'core' or directly under the project root
                     // and accessible from where the compiled JS will run.
                     // This path needs to be reliable. A common practice is to copy these assets to `out` dir during build.
                     // For this example, we'll try a path relative to this file's source location,
                     // assuming the schemas folder is at the root of the 'core' or project.
                     // This is a common source layout: project_root/core/schemas/system-blueprint.schema.json
                     // __dirname -> .../nexus/agents/personas
                     schemaPath = path.join(__dirname, '..', '..', '..', 'schemas', 'system-blueprint.schema.json');
                }

            } else { // Fallback for non-extension environments (e.g. testing)
                // These paths assume the command is run from a directory where these relative paths make sense
                // or that these files are alongside the compiled output.
                metaPromptPath = path.join(__dirname, '../prompts/architect_blueprint_metaprompt.md');
                schemaPath = path.join(__dirname, '../../../../schemas/system-blueprint.schema.json'); // Adjust if schema location differs
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("Meta-prompt 'architect_blueprint_metaprompt.md' loaded successfully.");

            this.log(`Attempting to load blueprint schema from: ${schemaPath}`);
            const schemaContent = await fs.readFile(schemaPath, 'utf8');
            this.blueprintSchema = JSON.parse(schemaContent) as Schema;
            this.log("System blueprint schema 'system-blueprint.schema.json' loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during initialization: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            this.blueprintSchema = null;
            if (typeof vscode !== 'undefined' && vscode.window) {
                 vscode.window.showErrorMessage(`ArchitectAgent initialization failed: ${errorMsg}. Blueprint generation may fail.`);
            }
        }
    }

    async execute(task: AgentTask, context: QuantumContext): Promise<AgentResult> {
        this.log(`Executing task: '${task.description}' with ID: ${task.taskId}`, task.userInput);

        if (!task.userInput || typeof task.userInput.description !== 'string' || task.userInput.description.trim() === '') {
            this.log("Task input validation failed: Missing or empty 'userInput.description'.", task.userInput);
            return {
                taskId: task.taskId,
                status: 'failure',
                error: "Task input is invalid: 'userInput.description' is required and must be a non-empty string.",
                output: null
            };
        }

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            this.log("Meta-prompt not loaded or loaded with error.", this.metaPromptContent);
            return {
                taskId: task.taskId,
                status: 'failure',
                error: `ArchitectAgent meta-prompt is not available. Cannot generate blueprint. Details: ${this.metaPromptContent}`,
                output: null
            };
        }
        if (!this.blueprintSchema) {
            this.log("Blueprint schema not loaded.");
            return {
                taskId: task.taskId,
                status: 'failure',
                error: "System blueprint schema is not available. Cannot validate generated blueprint.",
                output: null
            };
        }

        const userRequirement = task.userInput.description;
        let fullPromptForLlm = this.metaPromptContent.replace('USER_HIGH_LEVEL_REQUIREMENT_PLACEHOLDER', userRequirement);

        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            this.log(`Attempt ${attempt + 1}/${maxRetries + 1} to generate and validate blueprint for task: ${task.taskId}`);

            try {
                const llmResponse = await this.modelRouter.routeRequest(
                    fullPromptForLlm,
                    "System Blueprint Generation",
                    {
                        model: this.config.defaultModelId || undefined, // Use agent's preferred model or let router decide
                        temperature: 0.2,
                        // maxTokens: 4096 // Example, adjust based on model/provider
                    }
                );

                if (!llmResponse) {
                    this.log("LLM returned null or empty response.", { attempt: attempt + 1 });
                    if (attempt === maxRetries) {
                        return { taskId: task.taskId, status: 'failure', error: "LLM failed to return a response after multiple attempts.", output: null };
                    }
                    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
                    fullPromptForLlm = `The previous attempt to generate the blueprint returned no response. Please try again, ensuring you generate a complete YAML blueprint based on the original requirement.\n\nOriginal Request Context:\n${this.metaPromptContent.replace('USER_HIGH_LEVEL_REQUIREMENT_PLACEHOLDER', userRequirement)}`;
                    continue;
                }

                let yamlString = llmResponse.trim();
                const yamlBlockMatch = yamlString.match(/```yaml\n([\s\S]*?)\n```/);
                if (yamlBlockMatch && yamlBlockMatch[1]) {
                    yamlString = yamlBlockMatch[1].trim();
                } else {
                    const yamlStartIndex = yamlString.indexOf('projectMetadata:');
                    if (yamlStartIndex > -1) {
                        yamlString = yamlString.substring(yamlStartIndex);
                    } else if (yamlString.startsWith("---")) {
                        yamlString = yamlString.substring(3).trimLeft();
                    }
                    // Further cleanup for potential leading/trailing non-YAML text if necessary
                    if (!yamlString.startsWith("projectMetadata:")) {
                        // This is a heuristic, might need more robust cleaning
                        this.log("Warning: LLM output might contain leading non-YAML text. Attempting to clean.", {originalOutputStart: yamlString.substring(0,100)});
                    }
                }

                let parsedBlueprint: any;
                try {
                    parsedBlueprint = yaml.load(yamlString);
                    if (typeof parsedBlueprint !== 'object' || parsedBlueprint === null) {
                        throw new Error("Parsed YAML is not an object or is null.");
                    }
                } catch (e) {
                    const parseError = e instanceof Error ? e.message : String(e);
                    this.log(`YAML parsing failed (attempt ${attempt + 1}): ${parseError}`, { rawOutputFirst100Chars: yamlString.substring(0,100) });
                    if (attempt === maxRetries) {
                        return { taskId: task.taskId, status: 'failure', error: `Failed to parse generated YAML: ${parseError}`, output: { rawOutput: llmResponse } };
                    }
                    fullPromptForLlm = `The previous blueprint attempt was not valid YAML. Please ensure your output is correctly formatted YAML. Error: ${parseError}\n\nOriginal Request Context:\n${this.metaPromptContent.replace('USER_HIGH_LEVEL_REQUIREMENT_PLACEHOLDER', userRequirement)}\n\nPrevious Invalid Output (to correct, first 500 chars):\n${yamlString.substring(0,500)}`;
                    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
                    continue;
                }

                const ajv = new Ajv({ allErrors: true });
                const validate = ajv.compile(this.blueprintSchema); // Schema is already loaded
                const isValid = validate(parsedBlueprint);

                if (isValid) {
                    this.log("Generated blueprint successfully validated against schema.", { taskId: task.taskId });
                    return {
                        taskId: task.taskId,
                        status: 'success',
                        output: {
                            blueprintYaml: yamlString,
                            blueprintObject: parsedBlueprint
                        },
                        logs: ["Blueprint generated and validated successfully."]
                    };
                } else {
                    const validationErrors = ajv.errorsText(validate.errors, { separator: '\n- ', dataVar: 'blueprint' });
                    this.log(`Blueprint schema validation failed (attempt ${attempt + 1}): ${validationErrors}`, { errors: validate.errors });
                    if (attempt === maxRetries) {
                        return {
                            taskId: task.taskId,
                            status: 'failure',
                            error: `Generated blueprint failed schema validation after ${maxRetries + 1} attempts: ${validationErrors}`,
                            output: { rawOutput: llmResponse, parsedAttempt: parsedBlueprint, validationErrors: validate.errors }
                        };
                    }
                    fullPromptForLlm = `The previous blueprint attempt failed schema validation. Please correct the following errors:\n- ${validationErrors}\n\nEnsure the output strictly adheres to the schema. Review all required fields, data types, and enums.\n\nOriginal Request Context:\n${this.metaPromptContent.replace('USER_HIGH_LEVEL_REQUIREMENT_PLACEHOLDER', userRequirement)}\n\nPreviously generated (invalid) YAML to correct:\n${yamlString}`;
                    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                }

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.log(`Error during LLM call or processing (attempt ${attempt + 1}): ${errorMsg}`, error);
                if (attempt === maxRetries) {
                    return { taskId: task.taskId, status: 'failure', error: `LLM call failed after ${maxRetries + 1} attempts: ${errorMsg}`, output: null };
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                fullPromptForLlm = `An error occurred in the previous attempt: ${errorMsg}. Please try generating the blueprint again based on the original requirement.\n\nOriginal Request Context:\n${this.metaPromptContent.replace('USER_HIGH_LEVEL_REQUIREMENT_PLACEHOLDER', userRequirement)}`;
            }
        }

        this.log(`Failed to produce a valid blueprint after all retries for task: ${task.taskId}`);
        return {
            taskId: task.taskId,
            status: 'failure',
            error: "ArchitectAgent failed to produce a valid and schema-compliant blueprint after multiple attempts.",
            output: null
        };
    }
}

// Mock vscode for type checking or testing outside VS Code runtime
// This is purely for local type linting if this file were to be checked standalone.
if (typeof vscode === 'undefined') {
    global.vscode = {
        window: {
            showErrorMessage: (message: string) => console.error(message),
            showInformationMessage: (message: string) => console.log(message)
        },
        Uri: {
            file: (p: string) => ({ fsPath: p, joinPath: (...args: string[]) => vscode.Uri.file(path.join(p, ...args)) }), // Simplified mock
            joinPath: (base: any, ...pathSegments: string[]) => vscode.Uri.file(path.join(base.fsPath, ...pathSegments))
        },
        workspace: {
            fs: {
                readFile: async (uri: any) => fs.readFile(uri.fsPath),
                writeFile: async (uri: any, content: Uint8Array) => fs.writeFile(uri.fsPath, content),
                createDirectory: async (uri: any) => fs.mkdir(uri.fsPath, { recursive: true })
            }
        },
        FileSystemError: class FileSystemError extends Error { // Mock FileSystemError
            code: string;
            constructor(messageOrUri?: string | vscode.Uri, code?: string) {
                super(typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.toString());
                this.name = 'FileSystemError';
                this.code = code || 'Unknown';
            }
            static FileExists(messageOrUri?: string | vscode.Uri): vscode.FileSystemError {
                return new FileSystemError(messageOrUri, 'FileExists');
            }
        }
    };
}
```
