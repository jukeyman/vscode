import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml'; // For stringifying blueprint parts for the prompt
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext';
import { ModelRouter } from '../../ai/ModelRouter';

// Declare vscode for type-checking if used for paths, actual vscode module is available in extension runtime
declare var vscode: any;

export class TestingForgeAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "TestingForgeAgent",
            description: "Generates test suites (unit, integration, E2E stubs) from System Blueprints.",
            capabilities: [
                "unit_test_generation",
                "integration_test_stub_generation",
                "e2e_test_scenario_generation",
                "test_runner_configuration_stubs",
                "mock_data_suggestion_for_tests"
            ],
            tools: ["LLMModelRouterTool", "BlueprintAnalyzer_Testing", "TestFrameworkSyntaxKnowledge"], // Conceptual
            defaultModelId: "gpt-4-test-generation-expert", // Example
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("TestingForgeAgent instance created.");
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> {
        this.log("Initializing TestingForgeAgent: Loading meta-prompt...");
        try {
            let metaPromptPath: string;
            if (extensionUri && typeof vscode !== 'undefined' && vscode.Uri) {
                metaPromptPath = vscode.Uri.joinPath(extensionUri, 'out', 'nexus', 'agents', 'prompts', 'testing_forge_metaprompt.md').fsPath;
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                     metaPromptPath = path.join(__dirname, '../prompts/testing_forge_metaprompt.md');
                }
            } else {
                metaPromptPath = path.join(__dirname, '../prompts/testing_forge_metaprompt.md');
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("TestingForge meta-prompt loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error loading TestingForge meta-prompt: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            if (typeof vscode !== 'undefined' && vscode.window) {
                vscode.window.showErrorMessage(`TestingForgeAgent initialization failed: Could not load meta-prompt. ${errorMsg}`);
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
        if (!blueprint.testingStrategy || !blueprint.technologyStack || !blueprint.projectMetadata) {
            return this.createFailureResult(task.taskId, "Blueprint validation failed: Missing one or more required sections (testingStrategy, technologyStack, projectMetadata).");
        }

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            return this.createFailureResult(task.taskId, `TestingForge meta-prompt is not available or failed to load. Details: ${this.metaPromptContent}`);
        }

        let testingStrategyString = '';
        let techStackString = '';
        let dataModelsString = '';
        let apiEndpointsString = '';
        let uiComponentsString = ''; // Corrected variable name from prompt
        let projectMetadataString = '';

        try {
            testingStrategyString = yaml.dump(blueprint.testingStrategy);
            techStackString = yaml.dump(blueprint.technologyStack);
            dataModelsString = yaml.dump(blueprint.dataModels || []);
            apiEndpointsString = yaml.dump(blueprint.apiEndpoints || []);
            // Assuming uiComponents is under uiSpecification as per the meta-prompt's context
            uiComponentsString = yaml.dump(blueprint.uiSpecification || {}); // Send the whole uiSpecification
            projectMetadataString = yaml.dump(blueprint.projectMetadata);
        } catch (e) {
            const dumpError = e instanceof Error ? e.message : String(e);
            this.log("Error dumping blueprint sections to YAML for prompt:", dumpError);
            return this.createFailureResult(task.taskId, `Internal error preparing blueprint for LLM: ${dumpError}`);
        }

        const fullPrompt = this.metaPromptContent
            .replace('TESTING_STRATEGY_PLACEHOLDER', testingStrategyString)
            .replace('TECHNOLOGY_STACK_PLACEHOLDER', techStackString)
            .replace('DATA_MODELS_PLACEHOLDER', dataModelsString)
            .replace('API_ENDPOINTS_PLACEHOLDER', apiEndpointsString)
            .replace('UI_COMPONENTS_PLACEHOLDER', uiComponentsString) // Meta-prompt uses UI_COMPONENTS_PLACEHOLDER for uiSpecification
            .replace('UI_SPECIFICATION_PLACEHOLDER', uiComponentsString) // Also replace if this specific one is used
            .replace('PROJECT_METADATA_PLACEHOLDER', projectMetadataString);

        this.log("Prepared full prompt for LLM for test suite generation.");

        try {
            const llmResponseString = await this.modelRouter.routeRequest(
                fullPrompt,
                "Test Suite Generation from Blueprint",
                {
                    model: this.config.defaultModelId || undefined,
                    temperature: 0.1, // Low temperature for structured output like code/tests
                }
            );

            if (!llmResponseString) {
                this.log("LLM returned null or empty response for test suite generation.");
                return this.createFailureResult(task.taskId, "LLM failed to return a response for test suite generation.");
            }
            this.log("Received raw response from LLM for test suite generation.");

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
                    this.log("Could not find a clear JSON block in LLM response for test suite artifacts.", {rawResponseStart: jsonString.substring(0, 200)});
                    return this.createFailureResult(task.taskId, "LLM response was not in the expected JSON format (no clear JSON block).", {rawOutput: llmResponseString});
                }
            }

            let fileSet: Record<string, string>;
            try {
                fileSet = JSON.parse(jsonString);
            } catch (e) {
                const parseError = e instanceof Error ? e.message : String(e);
                this.log("Failed to parse LLM response as JSON for test suite artifacts.", { error: parseError, rawJsonStringAttempted: jsonString.substring(0,500) });
                return this.createFailureResult(task.taskId, `Failed to parse LLM response as JSON for test suite artifacts: ${parseError}`, {rawOutput: llmResponseString});
            }

            if (typeof fileSet !== 'object' || fileSet === null || Object.keys(fileSet).length === 0) {
                this.log("LLM response parsed to JSON, but it's empty or not an object for test suite artifacts.", fileSet);
                return this.createFailureResult(task.taskId, "Generated test suite file set is empty or invalid.", {rawOutput: llmResponseString, parsedOutput: fileSet});
            }

            for (const filePath in fileSet) {
                if (typeof fileSet[filePath] !== 'string') {
                     this.log(`Invalid content for test suite file ${filePath}: not a string.`, {contentType: typeof fileSet[filePath]});
                     return this.createFailureResult(task.taskId, `Generated content for test suite file ${filePath} is not a string.`, {rawOutput: llmResponseString, parsedOutput: fileSet});
                }
            }

            const numFiles = Object.keys(fileSet).length;
            this.log(`Test suite artifacts generated successfully. ${numFiles} files suggested.`);
            return {
                taskId: task.taskId,
                status: 'success',
                output: {
                    fileSet: fileSet,
                    message: `Successfully generated ${numFiles} test suite artifact files.`
                },
                logs: [`TestingForgeAgent successfully generated file set for task ${task.taskId}`]
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during LLM call or processing for test suite generation: ${errorMsg}`, error);
            return this.createFailureResult(task.taskId, `LLM call or processing failed for test suite generation: ${errorMsg}`);
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
