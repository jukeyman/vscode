import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import Ajv, { Schema } from 'ajv';
import * as yaml from 'js-yaml'; 
import { randomBytes } from 'crypto';
import axios from 'axios'; 
import EventSource from 'eventsource'; 
import * as cp from 'child_process'; 

// Global/Context Variables
const SIMULATION_SERVICE_URL = 'http://localhost:8123'; 
let simulationServiceProcess: cp.ChildProcess | null = null;
const activeSseConnections: Map<string, EventSource> = new Map(); 
let serviceOutputChannel: vscode.OutputChannel | undefined; 
let aiOutputChannel: vscode.OutputChannel | undefined;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanel: vscode.WebviewPanel | undefined = undefined; 
let simulatorPanelSimulationId: string | null = null;

let architectDominionMetaPrompt: string = ''; // To store the loaded meta-prompt

// Helper function to get workspace root URI
function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

// Helper function to get workspace root path
function getWorkspaceRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Helper function to get nonce
function getNonce() {
    return randomBytes(16).toString('base64');
}

// Generalized getWebviewHtml function
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, htmlSubPath: string, jsFileName: string): string {
    const htmlDiskPath = vscode.Uri.joinPath(extensionUri, 'webview', htmlSubPath);
    let htmlContent = "";
    try {
        htmlContent = fs.readFileSync(htmlDiskPath.fsPath, 'utf8');
    } catch (err) {
        console.error(`Error reading HTML file ${htmlDiskPath.fsPath}:`, err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        return `<html><body>Error loading webview content from ${htmlDiskPath.fsPath}. Error: ${errorMsg}</body></html>`;
    }
    const scriptDiskPath = vscode.Uri.joinPath(extensionUri, 'webview', nodePath.dirname(htmlSubPath), jsFileName);
    const scriptUri = webview.asWebviewUri(scriptDiskPath);
    const nonce = getNonce();
    htmlContent = htmlContent.replace(/\$\{webview\.cspSource\}/g, webview.cspSource);
    htmlContent = htmlContent.replace(new RegExp('\\$\\{nonce\\}', 'g'), nonce);
    htmlContent = htmlContent.replace(/\$\{scriptUri\}/g, scriptUri.toString());
    return htmlContent;
}

// Helper function to find agent definition files
async function findAgentDefinitionFiles(): Promise<vscode.Uri[]> {
    const wsRoot = getWorkspaceRootUri();
    if (!wsRoot) return [];
    return vscode.workspace.findFiles(new vscode.RelativePattern(wsRoot, '{agents/**/*.yaml,agents/**/*.yml,.jules/agents/**/*.yaml,.jules/agents/**/*.yml}'));
}

// Helper function to ensure the simulation service is running
async function ensureSimulationServiceIsRunning(context: vscode.ExtensionContext): Promise<boolean> {
    if (simulationServiceProcess && !simulationServiceProcess.killed) {
        try {
            await axios.get(SIMULATION_SERVICE_URL + "/docs", { timeout: 1000 }); 
            return true;
        } catch (e) {
            simulationServiceProcess.kill(); 
            simulationServiceProcess = null; 
        }
    }
    const workspaceRootPath = getWorkspaceRootPath();
    if (!workspaceRootPath) {
        vscode.window.showErrorMessage("No workspace open. Cannot start simulation service.");
        return false;
    }
    if (!serviceOutputChannel) {
        serviceOutputChannel = vscode.window.createOutputChannel("Simulation Service Logs");
        context.subscriptions.push(serviceOutputChannel);
    }
    serviceOutputChannel.show(true);
    serviceOutputChannel.appendLine("Attempting to start Python simulation service...");
    
    const serviceDir = nodePath.join(workspaceRootPath, 'simulation_service');
    const serviceMainPy = nodePath.join(serviceDir, 'main.py');

    if (!fs.existsSync(serviceMainPy)) {
        serviceOutputChannel.appendLine(`Error: Simulation service main.py not found at ${serviceMainPy}`);
        vscode.window.showErrorMessage(`Simulation service main.py not found at expected location: ${serviceMainPy}`);
        return false;
    }

    simulationServiceProcess = cp.spawn('uvicorn', ['main:app', '--host', '127.0.0.1', '--port', '8123'], { cwd: serviceDir, shell: true, detached: false });
    simulationServiceProcess.stdout?.on('data', (data) => serviceOutputChannel?.appendLine(`Service: ${data.toString().trim()}`));
    simulationServiceProcess.stderr?.on('data', (data) => serviceOutputChannel?.appendLine(`Service ERR: ${data.toString().trim()}`));
    simulationServiceProcess.on('error', (err) => {
        serviceOutputChannel?.appendLine(`Failed to start simulation service: ${err.message}`);
        vscode.window.showErrorMessage(`Failed to start simulation service: ${err.message}`);
        simulationServiceProcess = null;
    });
    simulationServiceProcess.on('exit', (code, signal) => {
        serviceOutputChannel?.appendLine(`Simulation service exited with code ${code}, signal ${signal}`);
        if (simulationServiceProcess && simulationServiceProcess.pid === (simulationServiceProcess as any).pid) { 
            simulationServiceProcess = null;
        }
    });

    return new Promise<boolean>((resolve) => {
        setTimeout(async () => {
            try {
                await axios.get(SIMULATION_SERVICE_URL + "/docs", { timeout: 3000 }); 
                serviceOutputChannel?.appendLine("Simulation service started successfully and is responsive.");
                resolve(true);
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                serviceOutputChannel?.appendLine(`Simulation service failed to respond after startup attempt: ${errorMsg}`);
                vscode.window.showErrorMessage(`Simulation service failed to start or respond: ${errorMsg}`);
                if (simulationServiceProcess && !simulationServiceProcess.killed) simulationServiceProcess.kill();
                simulationServiceProcess = null;
                resolve(false);
            }
        }, 5000); 
    });
}

// Helper function to load JSON Schema (can be used for agent or blueprint schema)
async function loadJsonSchema(context: vscode.ExtensionContext, schemaFileName: string): Promise<Schema | null> {
    const schemaPath = vscode.Uri.joinPath(context.extensionUri, 'schemas', schemaFileName);
    try {
        const schemaContentBytes = await vscode.workspace.fs.readFile(schemaPath);
        const schemaContent = Buffer.from(schemaContentBytes).toString('utf8');
        return JSON.parse(schemaContent) as Schema;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Error loading schema '${schemaFileName}': ${errorMsg}`);
        aiOutputChannel?.appendLine(`Error loading schema '${schemaFileName}': ${errorMsg}`);
        return null;
    }
}


// --- Simplified stubs for other commands (from previous steps) ---
function toSnakeCase(str: string): string { return str.replace(/\s+/g, '_').toLowerCase(); }
function toPascalCase(str: string): string { return str.replace(/(?:^|\s)\w/g, m => m.toUpperCase()).replace(/\s+/g, ''); }
function getPythonToolBoilerplate(className: string): string { return `class ${className}:\n    pass\n`; }


export async function activate(context: vscode.ExtensionContext) { // Made activate async
    if (!aiOutputChannel) {
        aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem Log"); 
        context.subscriptions.push(aiOutputChannel);
    }
    aiOutputChannel.appendLine('AI Ecosystem Core extension activated.');

    // Load Architect Dominion Meta-Prompt
    try {
        const metaPromptUri = vscode.Uri.joinPath(context.extensionUri, 'prompts', 'architect_dominion_metaprompt.md');
        const metaPromptBytes = await vscode.workspace.fs.readFile(metaPromptUri);
        architectDominionMetaPrompt = Buffer.from(metaPromptBytes).toString('utf8');
        aiOutputChannel.appendLine("Architect Dominion meta-prompt loaded successfully.");
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        architectDominionMetaPrompt = "Error: Could not load Architect Dominion meta-prompt. Blueprint generation will fail. Details: " + errorMsg;
        vscode.window.showErrorMessage("Failed to load Architect Dominion meta-prompt. Blueprint generation might not work as expected.");
        aiOutputChannel.appendLine("CRITICAL ERROR: Failed to load Architect Dominion meta-prompt: " + errorMsg);
    }


    // --- Register ai-ecosystem-core.setLlmApiKey command (from previous step) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.setLlmApiKey', async () => { /* ... */ }));
    // --- Register other existing commands (simplified stubs for brevity) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => {vscode.window.showInformationMessage('Hello World!');}));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.validateAgentDefinitions', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => { /* ... (Full logic from previous step) ... */}));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openSimulator', async () => { /* ... (Full logic from previous step) ... */ }));

    // --- Register ai-ecosystem-core.generateSystemBlueprint command (LLM-driven) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.generateSystemBlueprint', async () => {
        const workspaceRootPath = getWorkspaceRootPath();
        if (!workspaceRootPath) {
            vscode.window.showErrorMessage('Cannot generate blueprint: No workspace open.');
            return;
        }

        if (architectDominionMetaPrompt.startsWith("Error:")) {
            vscode.window.showErrorMessage("Blueprint generation failed: Meta-prompt not loaded correctly.");
            return;
        }

        const userPromptText = await vscode.window.showInputBox({
            prompt: "Enter a high-level description for the system you want to blueprint:",
            placeHolder: "e.g., A customer support portal with a knowledge base and live chat"
        });

        if (!userPromptText) {
            vscode.window.showInformationMessage("System blueprint generation cancelled.");
            return;
        }

        // Prepare LLM call
        const config = vscode.workspace.getConfiguration('aiEcosystem.llm');
        const provider = config.get<string>('provider');
        const modelId = config.get<string>('modelId');
        const apiKeySecretName = config.get<string>('apiKeySecretName');

        if (!apiKeySecretName) {
            vscode.window.showErrorMessage('LLM API Key secret name not configured in settings.');
            aiOutputChannel?.appendLine("Error: aiEcosystem.llm.apiKeySecretName is not set.");
            return;
        }
        const apiKey = await context.secrets.get(apiKeySecretName);
        if (!apiKey) {
            vscode.window.showErrorMessage('API Key not set. Use "AI Eco: Set LLM API Key" command.');
            aiOutputChannel?.appendLine("Error: LLM API Key not found in SecretStorage.");
            return;
        }

        const fullPromptForLlm = architectDominionMetaPrompt.replace('USER_REQUIREMENT_PLACEHOLDER', userPromptText);
        
        let apiUrl = '';
        let apiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        let apiBody: Record<string, any> = {};

        try {
            if (provider === 'openai') {
                apiUrl = 'https://api.openai.com/v1/chat/completions';
                apiHeaders['Authorization'] = `Bearer ${apiKey}`;
                apiBody = { model: modelId, messages: [{ role: 'user', content: fullPromptForLlm }] , temperature: 0.3 }; // Lower temp for more deterministic YAML
            } else if (provider === 'anthropic') {
                apiUrl = 'https://api.anthropic.com/v1/messages';
                apiHeaders['x-api-key'] = apiKey;
                apiHeaders['anthropic-version'] = '2023-06-01';
                apiBody = { model: modelId, max_tokens: 4000, messages: [{ role: 'user', content: fullPromptForLlm }], temperature: 0.3 };
            } else if (provider === 'ollama') {
                const ollamaBaseUrl = config.get<string>('ollama.baseUrl', 'http://localhost:11434');
                apiUrl = `${ollamaBaseUrl}/api/chat`;
                apiBody = { model: modelId, messages: [{ role: 'user', content: fullPromptForLlm }], stream: false, temperature: 0.3, options: { num_ctx: 4096 } };
            } else {
                vscode.window.showErrorMessage(`Unsupported LLM provider for blueprint generation: ${provider}`);
                return;
            }

            aiOutputChannel?.appendLine(`Generating blueprint with ${provider} (${modelId}). User prompt: "${userPromptText}"`);
            vscode.window.showInformationMessage(`Generating system blueprint with ${provider}... This may take a moment.`);

            const llmResponse = await axios.post(apiUrl, apiBody, { headers: apiHeaders, timeout: 120000 }); // 120s timeout
            
            let extractedYaml = '';
            if (provider === 'openai') {
                extractedYaml = llmResponse.data.choices?.[0]?.message?.content || '';
            } else if (provider === 'anthropic') {
                extractedYaml = llmResponse.data.content?.[0]?.text || '';
            } else if (provider === 'ollama') {
                extractedYaml = llmResponse.data.message?.content || '';
            }

            // Clean potential markdown backticks or "yaml" prefix if LLM adds them
            extractedYaml = extractedYaml.replace(/^```yaml\s*/, '').replace(/```\s*$/, '').trim();
            if (extractedYaml.startsWith("---")) extractedYaml = extractedYaml.substring(3).trimLeft(); // Remove potential --- prefix


            if (!extractedYaml) {
                vscode.window.showErrorMessage("LLM returned an empty response for the blueprint.");
                aiOutputChannel?.appendLine("LLM returned empty response.");
                return;
            }

            // Validate YAML output against schema
            const blueprintSchema = await loadJsonSchema(context, 'system-blueprint.schema.json');
            if (!blueprintSchema) {
                vscode.window.showErrorMessage("System blueprint schema could not be loaded. Cannot validate generated blueprint.");
                return;
            }

            let parsedBlueprint: any;
            try {
                parsedBlueprint = yaml.load(extractedYaml);
            } catch (yamlError: any) {
                vscode.window.showErrorMessage(`Generated blueprint is not valid YAML: ${yamlError.message}. See 'AI Ecosystem Log' for details and raw output.`);
                aiOutputChannel?.appendLine(`Invalid YAML from LLM:\n${extractedYaml}\nError: ${yamlError.message}`);
                return;
            }
            
            const ajv = new Ajv({ allErrors: true });
            const validate = ajv.compile(blueprintSchema);
            const isValid = validate(parsedBlueprint);

            if (!isValid) {
                const errors = validate.errors?.map(err => `  - Path: ${err.instancePath || '/'} Message: ${err.message} Params: ${JSON.stringify(err.params)}`).join('\n');
                vscode.window.showErrorMessage(`Generated blueprint failed schema validation. See 'AI Ecosystem Log' for details.`);
                aiOutputChannel?.appendLine(`Blueprint schema validation failed. Errors:\n${errors}\n\nGenerated YAML:\n${extractedYaml}`);
                // Optionally save the invalid blueprint for debugging
                // const invalidBlueprintPath = nodePath.join(workspaceRootPath, 'blueprints', `invalid_blueprint_${timestamp}.yaml`);
                // await vscode.workspace.fs.writeFile(vscode.Uri.file(invalidBlueprintPath), Buffer.from(extractedYaml, 'utf8'));
                // aiOutputChannel?.appendLine(`Invalid blueprint saved to ${invalidBlueprintPath}`);
                return;
            }
            
            // Save validated blueprint
            const blueprintsDir = nodePath.join(workspaceRootPath, 'blueprints');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(blueprintsDir)); // Ensure exists

            const timestamp = new Date().toISOString().replace(/[.:T]/g, '-').slice(0, -5);
            const blueprintBaseName = (parsedBlueprint?.projectMetadata?.projectName || "unnamed_system").replace(/\s+/g, '_').replace(/[^\w-]/g, '');
            const blueprintFileName = `blueprint_${blueprintBaseName}_${timestamp}.yaml`;
            const blueprintFilePath = nodePath.join(blueprintsDir, blueprintFileName);
            
            await vscode.workspace.fs.writeFile(vscode.Uri.file(blueprintFilePath), Buffer.from(extractedYaml, 'utf8')); // Save the original, validated YAML
            
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(blueprintFilePath));
            await vscode.window.showTextDocument(document);
            vscode.window.showInformationMessage(`System blueprint '${blueprintFileName}' generated and validated successfully in 'blueprints' directory.`);
            aiOutputChannel?.appendLine(`System blueprint '${blueprintFileName}' generated, validated, and saved to ${blueprintFilePath}`);

        } catch (error: any) {
            let errorMessage = 'Unknown error during blueprint generation.';
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    errorMessage = `API Error ${error.response.status}: ${JSON.stringify(error.response.data, null, 2)}`;
                } else if (error.request) {
                    errorMessage = `Network Error: No response received from LLM API. URL: ${apiUrl}`;
                } else {
                    errorMessage = `Request Setup Error: ${error.message}`;
                }
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
            aiOutputChannel?.appendLine(`LLM API Error for blueprint generation: ${errorMessage}`);
            vscode.window.showErrorMessage(`Blueprint Generation Failed: ${errorMessage}`);
        }
    }));
}

export function deactivate() {
    aiOutputChannel?.appendLine("Deactivating AI Ecosystem Core extension.");
    activeSseConnections.forEach((sse, simId) => {
        sse.close();
        axios.post(`${SIMULATION_SERVICE_URL}/simulations/${simId}/control`, { command: 'stop' })
             .catch(err => aiOutputChannel?.appendLine(`Error stopping sim ${simId} on deactivate: ${err}`));
    });
    activeSseConnections.clear();

    if (simulationServiceProcess && !simulationServiceProcess.killed) {
        simulationServiceProcess.kill(); 
        simulationServiceProcess = null;
    }
    
    aiOutputChannel?.dispose();
    serviceOutputChannel?.dispose(); 
    promptEngineerPanel?.dispose();
    simulatorPanel?.dispose(); 
}
```
