import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml'; // For stringifying blueprint parts for the prompt
import { BaseAgent } from '../BaseAgent';
import { AgentConfig, AgentTask, AgentResult, IAgent } from '../IAgent';
import { QuantumContext } from '../../context/QuantumContext';
import { ModelRouter } from '../../ai/ModelRouter';

// Declare vscode for type-checking if used for paths, actual vscode module is available in extension runtime
declare var vscode: any;

export class DatabaseForgeAgent extends BaseAgent implements IAgent {
    private modelRouter: ModelRouter;
    private metaPromptContent: string = '';

    constructor(modelRouter: ModelRouter, config?: Partial<AgentConfig>) {
        super({
            agentName: "DatabaseForgeAgent",
            description: "Generates database schemas, ORM models, and other database artifacts from System Blueprints.",
            capabilities: [
                "database_schema_generation",
                "sql_migration_scripting",
                "nosql_schema_definition",
                "orm_model_generation",
                "database_seeding_script_stubs"
            ],
            tools: ["LLMModelRouterTool", "BlueprintParser_DB", "SQLDialectKnowledgeBase", "ORMCodeGenerator"], // Conceptual
            defaultModelId: "gpt-4-database-schema-expert", // Example
            ...(config || {})
        });
        this.modelRouter = modelRouter;
        this.log("DatabaseForgeAgent instance created.");
    }

    async initialize(extensionUri?: vscode.Uri): Promise<void> {
        this.log("Initializing DatabaseForgeAgent: Loading meta-prompt...");
        try {
            let metaPromptPath: string;
            if (extensionUri && typeof vscode !== 'undefined' && vscode.Uri) {
                metaPromptPath = vscode.Uri.joinPath(extensionUri, 'out', 'nexus', 'agents', 'prompts', 'database_forge_metaprompt.md').fsPath;
                if (!await fs.stat(metaPromptPath).then(() => true).catch(() => false)) {
                     metaPromptPath = path.join(__dirname, '../prompts/database_forge_metaprompt.md');
                }
            } else {
                metaPromptPath = path.join(__dirname, '../prompts/database_forge_metaprompt.md');
            }

            this.log(`Attempting to load meta-prompt from: ${metaPromptPath}`);
            this.metaPromptContent = await fs.readFile(metaPromptPath, 'utf8');
            this.log("DatabaseForge meta-prompt loaded successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error loading DatabaseForge meta-prompt: ${errorMsg}`, error);
            this.metaPromptContent = `Error: Meta-prompt could not be loaded. Details: ${errorMsg}`;
            if (typeof vscode !== 'undefined' && vscode.window) {
                vscode.window.showErrorMessage(`DatabaseForgeAgent initialization failed: Could not load meta-prompt. ${errorMsg}`);
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
        if (!blueprint.databaseSpecification || !blueprint.dataModels || !blueprint.backendSpecification || !blueprint.projectMetadata) {
            return this.createFailureResult(task.taskId, "Blueprint validation failed: Missing one or more required sections (databaseSpecification, dataModels, backendSpecification, projectMetadata).");
        }

        if (!this.metaPromptContent || this.metaPromptContent.startsWith("Error:")) {
            return this.createFailureResult(task.taskId, `DatabaseForge meta-prompt is not available or failed to load. Details: ${this.metaPromptContent}`);
        }

        let databaseSpecString = '';
        let dataModelsString = '';
        let backendSpecString = '';
        let projectMetadataString = '';
        try {
            databaseSpecString = yaml.dump(blueprint.databaseSpecification);
            dataModelsString = yaml.dump(blueprint.dataModels); // Or databaseSpecification.schemaDefinitions
            backendSpecString = yaml.dump(blueprint.backendSpecification);
            projectMetadataString = yaml.dump(blueprint.projectMetadata);
        } catch (e) {
            const dumpError = e instanceof Error ? e.message : String(e);
            this.log("Error dumping blueprint sections to YAML for prompt:", dumpError);
            return this.createFailureResult(task.taskId, `Internal error preparing blueprint for LLM: ${dumpError}`);
        }

        const fullPrompt = this.metaPromptContent
            .replace('DATABASE_SPECIFICATION_PLACEHOLDER', databaseSpecString)
            .replace('DATA_MODELS_PLACEHOLDER', dataModelsString)
            .replace('BACKEND_SPECIFICATION_PLACEHOLDER', backendSpecString)
            .replace('PROJECT_METADATA_PLACEHOLDER', projectMetadataString);

        this.log("Prepared full prompt for LLM for database artifact generation.");

        try {
            const llmResponseString = await this.modelRouter.routeRequest(
                fullPrompt,
                "Database Artifact Generation from Blueprint",
                {
                    model: this.config.defaultModelId || undefined,
                    temperature: 0.1,
                }
            );

            if (!llmResponseString) {
                this.log("LLM returned null or empty response for database artifacts.");
                return this.createFailureResult(task.taskId, "LLM failed to return a response for database artifacts.");
            }
            this.log("Received raw response from LLM for database artifact generation.");

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
                    this.log("Could not find a clear JSON block in LLM response for database artifacts.", {rawResponseStart: llmResponseString.substring(0, 200)});
                    return this.createFailureResult(task.taskId, "LLM response was not in the expected JSON format (no clear JSON block).", {rawOutput: llmResponseString});
                }
            }

            let fileSet: Record<string, string>;
            try {
                fileSet = JSON.parse(jsonString);
            } catch (e) {
                const parseError = e instanceof Error ? e.message : String(e);
                this.log("Failed to parse LLM response as JSON for database artifacts.", { error: parseError, rawJsonStringAttempted: jsonString.substring(0,500) });
                return this.createFailureResult(task.taskId, `Failed to parse LLM response as JSON for database artifacts: ${parseError}`, {rawOutput: llmResponseString});
            }

            if (typeof fileSet !== 'object' || fileSet === null || Object.keys(fileSet).length === 0) {
                this.log("LLM response parsed to JSON, but it's empty or not an object for database artifacts.", fileSet);
                return this.createFailureResult(task.taskId, "Generated database artifact file set is empty or invalid.", {rawOutput: llmResponseString, parsedOutput: fileSet});
            }

            for (const filePath in fileSet) {
                if (typeof fileSet[filePath] !== 'string') {
                     this.log(`Invalid content for database file ${filePath}: not a string.`, {contentType: typeof fileSet[filePath]});
                     return this.createFailureResult(task.taskId, `Generated content for database file ${filePath} is not a string.`, {rawOutput: llmResponseString, parsedOutput: fileSet});
                }
            }

            const numFiles = Object.keys(fileSet).length;
            this.log(`Database artifacts generated successfully. ${numFiles} files suggested.`);
            return {
                taskId: task.taskId,
                status: 'success',
                output: {
                    fileSet: fileSet,
                    message: `Successfully generated ${numFiles} database artifact files.`
                },
                logs: [`DatabaseForgeAgent successfully generated file set for task ${task.taskId}`]
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.log(`Error during LLM call or processing for database artifact generation: ${errorMsg}`, error);
            return this.createFailureResult(task.taskId, `LLM call or processing failed for database artifacts: ${errorMsg}`);
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
