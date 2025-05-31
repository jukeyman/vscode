import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml'; // For stringifying blueprint parts for the prompt
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext';
import { ModelRouter } from '../../ai/ModelRouter';

// Declare vscode for type-checking if used for paths, actual vscode module is available in extension runtime
declare var vscode: any;

export class FrontendForgeAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "FrontendForgeAgent",
            description: "Generates frontend codebases (React, Vue, Next.js, Svelte, etc.) from System Blueprints.",
            capabilities: [
                "frontend_code_generation",
                "ui_component_generation",
                "routing_setup_scaffolding",
                "state_management_scaffolding",
                "api_client_integration_stubs",
                "build_tool_configuration_frontend",
                "package_json_generation_frontend",
                "dockerfile_generation_frontend",
                "unit_test_generation_frontend_stubs"
            ],
            tools: ["LLMModelRouterTool", "BlueprintParser", "FrontendTemplateGenerator"], // Conceptual tools
            defaultModelId: "gpt-4-frontend-code-gen", // Example, specific model for this agent
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("FrontendForgeAgent instance created.");
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> {
        this.log("Initializing FrontendForgeAgent: Loading meta-prompt...");
        try {
            let metaPromptPath: string;
             // Resolve path based on context (extension runtime vs. other environments)
            if (extensionUri && typeof vscode !== 'undefined' && vscode.Uri) { // Check if vscode.Uri is constructor
                metaPromptPath = vscode.Uri.joinPath(extensionUri, 'out', 'nexus', 'agents', 'prompts', 'frontend_forge_metaprompt.md').fsPath;
                // Fallback for development if not found in 'out'
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                    metaPromptPath = path.join(__dirname, '../prompts/frontend_forge_metaprompt.md');
                }
            } else { // Fallback for non-extension environments (e.g. testing, or if vscode is not available)
                metaPromptPath = path.join(__dirname, '../prompts/frontend_forge_metaprompt.md');
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("FrontendForge meta-prompt loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error loading FrontendForge meta-prompt: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            if (typeof vscode !== 'undefined' && vscode.window) {
                vscode.window.showErrorMessage(`FrontendForgeAgent initialization failed: Could not load meta-prompt. ${errorMsg}`);
            }
        }
        await super.initialize?.();
    }

    async execute(task: AgentTask, context: QuantumContext): Promise<AgentResult> {
        this.log(`Executing task: '${task.description}' with ID: ${task.taskId}`, task.userInput);

        if (!task.userInput?.blueprint) {
            return this.createFailureResult(task.taskId, "Task input validation failed: Missing 'blueprint' in userInput.");
        }

        const blueprint = task.userInput.blueprint;
        if (!blueprint.frontendSpecification || !blueprint.projectMetadata) {
            return this.createFailureResult(task.taskId, "Blueprint validation failed: Missing one or more required sections (frontendSpecification, projectMetadata). API Endpoints are recommended.");
        }
        // apiEndpoints can be optional for some purely static frontend, but usually needed
        const apiEndpoints = blueprint.apiEndpoints || [];

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            return this.createFailureResult(task.taskId, `FrontendForge meta-prompt is not available or failed to load. Details: ${this.metaPromptContent}`);
        }

        let frontendSpecString = '';
        let apiEndpointsString = '';
        let projectMetadataString = '';
        try {
            frontendSpecString = yaml.dump(blueprint.frontendSpecification);
            apiEndpointsString = yaml.dump(apiEndpoints);
            projectMetadataString = yaml.dump(blueprint.projectMetadata);
        } catch (e) {
            const dumpError = e instanceof Error ? e.message : String(e);
            this.log("Error dumping blueprint sections to YAML for prompt:", dumpError);
            return this.createFailureResult(task.taskId, `Internal error preparing blueprint for LLM: ${dumpError}`);
        }

        const fullPrompt = this.metaPromptContent
            .replace('FRONTEND_SPECIFICATION_PLACEHOLDER', frontendSpecString)
            .replace('API_ENDPOINTS_PLACEHOLDER', apiEndpointsString)
            .replace('PROJECT_METADATA_PLACEHOLDER', projectMetadataString);

        this.log("Prepared full prompt for LLM based on blueprint sections for frontend generation.");

        try {
            const llmResponseString = await this.modelRouter.routeRequest(
                fullPrompt,
                "Frontend Code Generation from Blueprint",
                {
                    model: this.config.defaultModelId || undefined,
                    temperature: 0.1,
                    // maxTokens might need to be very high, consider if model has good JSON mode
                }
            );

            if (!llmResponseString) {
                this.log("LLM returned null or empty response for frontend generation.");
                return this.createFailureResult(task.taskId, "LLM failed to return a response for frontend generation.");
            }
            this.log("Received raw response from LLM for frontend generation.");

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
                    this.log("Could not find a clear JSON block in LLM response for frontend.", {rawResponseStart: llmResponseString.substring(0, 200)});
                    return this.createFailureResult(task.taskId, "LLM response was not in the expected JSON format (no clear JSON block).", {rawOutput: llmResponseString});
                }
            }

            let fileSet: Record<string, string>;
            try {
                fileSet = JSON.parse(jsonString);
            } catch (e) {
                const parseError = e instanceof Error ? e.message : String(e);
                this.log("Failed to parse LLM response as JSON for frontend.", { error: parseError, rawJsonStringAttempted: jsonString.substring(0,500) });
                return this.createFailureResult(task.taskId, `Failed to parse LLM response as JSON for frontend: ${parseError}`, {rawOutput: llmResponseString});
            }

            if (typeof fileSet !== 'object' || fileSet === null || Object.keys(fileSet).length === 0) {
                this.log("LLM response parsed to JSON, but it's empty or not an object for frontend.", fileSet);
                return this.createFailureResult(task.taskId, "Generated frontend file set is empty or invalid.", {rawOutput: llmResponseString, parsedOutput: fileSet});
            }

            for (const filePath in fileSet) {
                if (typeof fileSet[filePath] !== 'string') {
                     this.log(`Invalid content for frontend file ${filePath}: not a string.`, {contentType: typeof fileSet[filePath]});
                     return this.createFailureResult(task.taskId, `Generated content for frontend file ${filePath} is not a string.`, {rawOutput: llmResponseString, parsedOutput: fileSet});
                }
            }

            const numFiles = Object.keys(fileSet).length;
            this.log(`Frontend codebase generated successfully. ${numFiles} files suggested.`);
            return {
                taskId: task.taskId,
                status: 'success',
                output: {
                    fileSet: fileSet,
                    message: `Successfully generated ${numFiles} frontend files.`
                },
                logs: [`FrontendForgeAgent successfully generated file set for task ${task.taskId}`]
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during LLM call or processing for frontend generation: ${errorMsg}`, error);
            return this.createFailureResult(task.taskId, `LLM call or processing failed for frontend: ${errorMsg}`);
        }
    }

    private createFailureResult(taskId: string, error: string, outputDetails: any = null): AgentResult {
        return {
            taskId: taskId,
            status: 'failure',
            error: error,
            output: outputDetails ? outputDetails : { rawOutput: null }
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
                // Add other fs methods if needed by other agents during testing
            }
        }
    };
}
```
