import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml'; // For stringifying the full blueprint for the prompt
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext';
import { ModelRouter } from '../../ai/ModelRouter';

// Declare vscode for type-checking if used for paths, actual vscode module is available in extension runtime
declare var vscode: any;

export class DocumentationForgeAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "DocumentationForgeAgent",
            description: "Generates project documentation (README, API docs, etc.) from System Blueprints.",
            capabilities: [
                "readme_generation",
                "api_documentation_generation_from_blueprint",
                "usage_guide_writing_stubs",
                "contribution_guideline_creation_stubs"
            ],
            tools: ["LLMModelRouterTool", "BlueprintAnalyzer_Documentation", "MarkdownSyntaxKnowledge"], // Conceptual
            defaultModelId: "gpt-3.5-turbo-documentation", // Example, can be more powerful
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("DocumentationForgeAgent instance created.");
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> {
        this.log("Initializing DocumentationForgeAgent: Loading meta-prompt...");
        try {
            let metaPromptPath: string;
            if (extensionUri && typeof vscode !== 'undefined' && vscode.Uri) {
                metaPromptPath = vscode.Uri.joinPath(extensionUri, 'out', 'nexus', 'agents', 'prompts', 'documentation_forge_metaprompt.md').fsPath;
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                     metaPromptPath = path.join(__dirname, '../prompts/documentation_forge_metaprompt.md');
                }
            } else {
                metaPromptPath = path.join(__dirname, '../prompts/documentation_forge_metaprompt.md');
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("DocumentationForge meta-prompt loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error loading DocumentationForge meta-prompt: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            if (typeof vscode !== 'undefined' && vscode.window) {
                vscode.window.showErrorMessage(`DocumentationForgeAgent initialization failed: Could not load meta-prompt. ${errorMsg}`);
            }
        }
        await super.initialize?.();
    }

    async execute(task: AgentTask, context: QuantumContext): Promise<AgentResult> {
        this.log(`Executing task: '${task.description}' with ID: ${task.taskId}`, task.userInput);

        if (!task.userInput?.blueprint || typeof task.userInput.blueprint !== 'object') {
            return this.createFailureResult(task.taskId, "Task input validation failed: Missing or invalid 'blueprint' object in userInput.");
        }

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            return this.createFailureResult(task.taskId, `DocumentationForge meta-prompt is not available or failed to load. Details: ${this.metaPromptContent}`);
        }

        let fullBlueprintYamlString = '';
        try {
            fullBlueprintYamlString = yaml.dump(task.userInput.blueprint);
        } catch (e) {
            const dumpError = e instanceof Error ? e.message : String(e);
            this.log("Error dumping full blueprint to YAML for prompt:", dumpError);
            return this.createFailureResult(task.taskId, `Internal error preparing blueprint for LLM: ${dumpError}`);
        }

        const fullPrompt = this.metaPromptContent
            .replace('FULL_SYSTEM_BLUEPRINT_YAML_PLACEHOLDER', fullBlueprintYamlString);

        this.log("Prepared full prompt for LLM for documentation generation.");

        try {
            const llmResponseString = await this.modelRouter.routeRequest(
                fullPrompt,
                "Documentation Generation from Blueprint",
                {
                    model: this.config.defaultModelId || undefined,
                    temperature: 0.2, // Slightly higher temperature for creative text like docs
                }
            );

            if (!llmResponseString) {
                this.log("LLM returned null or empty response for documentation generation.");
                return this.createFailureResult(task.taskId, "LLM failed to return a response for documentation generation.");
            }
            this.log("Received raw response from LLM for documentation generation.");

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
                    this.log("Could not find a clear JSON block in LLM response for documentation.", {rawResponseStart: jsonString.substring(0, 200)});
                    return this.createFailureResult(task.taskId, "LLM response was not in the expected JSON format (no clear JSON block).", {rawOutput: llmResponseString});
                }
            }

            let fileSet: Record<string, string>;
            try {
                fileSet = JSON.parse(jsonString);
            } catch (e) {
                const parseError = e instanceof Error ? e.message : String(e);
                this.log("Failed to parse LLM response as JSON for documentation.", { error: parseError, rawJsonStringAttempted: jsonString.substring(0,500) });
                return this.createFailureResult(task.taskId, `Failed to parse LLM response as JSON for documentation: ${parseError}`, {rawOutput: llmResponseString});
            }

            if (typeof fileSet !== 'object' || fileSet === null || Object.keys(fileSet).length === 0) {
                this.log("LLM response parsed to JSON, but it's empty or not an object for documentation.", fileSet);
                return this.createFailureResult(task.taskId, "Generated documentation file set is empty or invalid.", {rawOutput: llmResponseString, parsedOutput: fileSet});
            }

            for (const filePath in fileSet) {
                if (typeof fileSet[filePath] !== 'string') {
                     this.log(`Invalid content for documentation file ${filePath}: not a string.`, {contentType: typeof fileSet[filePath]});
                     return this.createFailureResult(task.taskId, `Generated content for documentation file ${filePath} is not a string.`, {rawOutput: llmResponseString, parsedOutput: fileSet});
                }
            }

            const numFiles = Object.keys(fileSet).length;
            this.log(`Documentation files generated successfully. ${numFiles} files suggested.`);
            return {
                taskId: task.taskId,
                status: 'success',
                output: {
                    fileSet: fileSet,
                    message: `Successfully generated ${numFiles} documentation files.`
                },
                logs: [`DocumentationForgeAgent successfully generated file set for task ${task.taskId}`]
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during LLM call or processing for documentation generation: ${errorMsg}`, error);
            return this.createFailureResult(task.taskId, `LLM call or processing failed for documentation: ${errorMsg}`);
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
            }
        }
    };
}
```
