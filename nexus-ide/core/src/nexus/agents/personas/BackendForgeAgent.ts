import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml'; // Used for stringifying blueprint parts for the prompt
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext';
import { ModelRouter } from '../../ai/ModelRouter';

// Declare vscode for type-checking, actual vscode module is available in extension runtime
declare var vscode: any;

export class BackendForgeAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "BackendForgeAgent",
            description: "Generates backend codebases (e.g., FastAPI, Express) from System Blueprints.",
            capabilities: [
                "backend_code_generation",
                "api_endpoint_implementation",
                "orm_integration_scaffolding",
                "authentication_boilerplate_generation",
                "unit_test_generation_backend_stubs",
                "dockerfile_generation_backend",
                "dependency_file_generation"
            ],
            tools: ["LLMModelRouterTool", "BlueprintParser"], // Conceptual tools
            defaultModelId: "gpt-4-turbo-code-generation", // Example, specific model for this agent
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("BackendForgeAgent instance created.");
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> { // Accept extensionUri
        this.log("Initializing BackendForgeAgent: Loading meta-prompt...");
        try {
            let metaPromptPath: string;
            if (extensionUri) { // Running in VS Code extension context
                metaPromptPath = path.join(extensionUri.fsPath, 'out', 'nexus', 'agents', 'prompts', 'backend_forge_metaprompt.md');
                 // Fallback for development if not found in 'out'
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                     metaPromptPath = path.join(__dirname, '../prompts/backend_forge_metaprompt.md');
                }
            } else { // Fallback for non-extension environments (e.g. testing)
                metaPromptPath = path.join(__dirname, '../prompts/backend_forge_metaprompt.md');
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("BackendForge meta-prompt loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error loading BackendForge meta-prompt: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            // Depending on strictness, you might want to throw this error to prevent agent registration
            // For now, it will proceed but fail during execute if meta-prompt is missing.
            if (typeof vscode !== 'undefined' && vscode.window) {
                vscode.window.showErrorMessage(`BackendForgeAgent initialization failed: Could not load meta-prompt. ${errorMsg}`);
            }
        }
        await super.initialize?.(); // Call base initialize if it exists and does something
    }

    async execute(task: AgentTask, context: QuantumContext): Promise<AgentResult> {
        this.log(`Executing task: '${task.description}' with ID: ${task.taskId}`, task.userInput);

        if (!task.userInput?.blueprint) {
            return this.createFailureResult(task.taskId, "Task input validation failed: Missing 'blueprint' in userInput.");
        }

        const blueprint = task.userInput.blueprint;
        if (!blueprint.backendSpecification || !blueprint.dataModels || !blueprint.databaseSpecification) {
            return this.createFailureResult(task.taskId, "Blueprint validation failed: Missing one or more required sections (backendSpecification, dataModels, databaseSpecification).");
        }

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            return this.createFailureResult(task.taskId, `BackendForge meta-prompt is not available or failed to load. Details: ${this.metaPromptContent}`);
        }

        // Prepare blueprint sections for the prompt
        let backendSpecString = '';
        let dataModelsString = '';
        let databaseSpecString = '';
        try {
            backendSpecString = yaml.dump(blueprint.backendSpecification);
            dataModelsString = yaml.dump(blueprint.dataModels);
            databaseSpecString = yaml.dump(blueprint.databaseSpecification);
        } catch (e) {
            const dumpError = e instanceof Error ? e.message : String(e);
            this.log("Error dumping blueprint sections to YAML for prompt:", dumpError);
            return this.createFailureResult(task.taskId, `Internal error preparing blueprint for LLM: ${dumpError}`);
        }

        const fullPrompt = this.metaPromptContent
            .replace('BACKEND_SPECIFICATION_PLACEHOLDER', backendSpecString)
            .replace('DATA_MODELS_PLACEHOLDER', dataModelsString)
            .replace('DATABASE_SPECIFICATION_PLACEHOLDER', databaseSpecString);

        this.log("Prepared full prompt for LLM based on blueprint sections.");

        try {
            const llmResponseString = await this.modelRouter.routeRequest(
                fullPrompt,
                "Backend Code Generation from Blueprint",
                {
                    model: this.config.defaultModelId || undefined,
                    temperature: 0.1, // Low temperature for code generation
                    // maxTokens: 8000 // Example, might need to be very high for full codebases
                }
            );

            if (!llmResponseString) {
                this.log("LLM returned null or empty response for backend generation.");
                return this.createFailureResult(task.taskId, "LLM failed to return a response for backend generation.");
            }
            this.log("Received raw response from LLM for backend generation.");

            let jsonString = llmResponseString.trim();
            const jsonBlockMatch = jsonString.match(/```json\n([\s\S]*?)\n```/s);
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonString = jsonBlockMatch[1].trim();
            } else {
                const firstBrace = jsonString.indexOf('{');
                const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                } else {
                    this.log("Could not find a clear JSON block in LLM response.", {rawResponseStart: llmResponseString.substring(0, 200)});
                    return this.createFailureResult(task.taskId, "LLM response was not in the expected JSON format (no clear JSON block).", {rawOutput: llmResponseString});
                }
            }

            let fileSet: Record<string, string>;
            try {
                fileSet = JSON.parse(jsonString);
            } catch (e) {
                const parseError = e instanceof Error ? e.message : String(e);
                this.log("Failed to parse LLM response as JSON.", { error: parseError, rawJsonStringAttempted: jsonString.substring(0,500) });
                return this.createFailureResult(task.taskId, `Failed to parse LLM response as JSON: ${parseError}`, {rawOutput: llmResponseString});
            }

            if (typeof fileSet !== 'object' || fileSet === null || Object.keys(fileSet).length === 0) {
                this.log("LLM response parsed to JSON, but it's empty or not an object.", fileSet);
                return this.createFailureResult(task.taskId, "Generated file set is empty or invalid.", {rawOutput: llmResponseString, parsedOutput: fileSet});
            }

            for (const filePath in fileSet) {
                if (typeof fileSet[filePath] !== 'string') {
                     this.log(`Invalid content for file ${filePath}: not a string.`, {contentType: typeof fileSet[filePath]});
                     return this.createFailureResult(task.taskId, `Generated content for ${filePath} is not a string.`, {rawOutput: llmResponseString, parsedOutput: fileSet});
                }
            }

            this.log(`Backend codebase generated successfully. ${Object.keys(fileSet).length} files suggested.`);
            return {
                taskId: task.taskId,
                status: 'success',
                output: {
                    fileSet: fileSet,
                    message: `Successfully generated ${Object.keys(fileSet).length} backend files.`
                },
                logs: [`BackendForgeAgent successfully generated file set for task ${task.taskId}`]
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during LLM call or processing for backend generation: ${errorMsg}`, error);
            return this.createFailureResult(task.taskId, `LLM call or processing failed: ${errorMsg}`);
        }
    }

    private createFailureResult(taskId: string, error: string, outputDetails: any = null): AgentResult {
        return {
            taskId: taskId,
            status: 'failure',
            error: error,
            output: outputDetails ? outputDetails : { rawOutput: null } // Ensure output is not just null
        };
    }
}

// Mock vscode for type checking or testing outside VS Code runtime
if (typeof vscode === 'undefined') {
    global.vscode = {
        window: {
            showErrorMessage: (message: string) => console.error("VSCODE_MOCK_ERROR:", message),
            showInformationMessage: (message: string) => console.log("VSCODE_MOCK_INFO:", message)
        },
        Uri: {
            file: (p: string) => ({ fsPath: p }),
            joinPath: (base: any, ...pathSegments: string[]) => ({ fsPath: path.join(base.fsPath, ...pathSegments) })
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
            constructor(messageOrUri?: string | any, code?: string) {
                super(typeof messageOrUri === 'string' ? messageOrUri : messageOrUri?.toString());
                this.name = 'FileSystemError';
                this.code = code || 'Unknown';
            }
        }
    };
}
```
