import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import Ajv, { Schema } from 'ajv';
import * as yaml from 'js-yaml'; 
import { randomBytes } from 'crypto';
import axios from 'axios'; 
import EventSource from 'eventsource'; 
import * as cp from 'child_process'; 

// Global/Context Variables (from previous steps)
const SIMULATION_SERVICE_URL = 'http://localhost:8123'; 
let simulationServiceProcess: cp.ChildProcess | null = null;
const activeSseConnections: Map<string, EventSource> = new Map(); 
let serviceOutputChannel: vscode.OutputChannel | undefined; 
let aiOutputChannel: vscode.OutputChannel | undefined;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanel: vscode.WebviewPanel | undefined = undefined; 
let simulatorPanelSimulationId: string | null = null;


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

// Generalized getWebviewHtml function (from previous steps)
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

// Helper function to find agent definition files (from previous steps)
async function findAgentDefinitionFiles(): Promise<vscode.Uri[]> {
    const wsRoot = getWorkspaceRootUri();
    if (!wsRoot) return [];
    return vscode.workspace.findFiles(new vscode.RelativePattern(wsRoot, '{agents/**/*.yaml,agents/**/*.yml,.jules/agents/**/*.yaml,.jules/agents/**/*.yml}'));
}

// Helper function to ensure the simulation service is running (from previous steps)
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


// --- Simplified stubs for other commands (from previous steps) ---
function getAgentSchema(workspaceRootPath: string): Schema | null { /* ... */ return null; }
function toSnakeCase(str: string): string { return str.replace(/\s+/g, '_').toLowerCase(); }
function toPascalCase(str: string): string { return str.replace(/(?:^|\s)\w/g, m => m.toUpperCase()).replace(/\s+/g, ''); }
function getPythonToolBoilerplate(className: string): string { return `class ${className}:\n    pass\n`; }


export function activate(context: vscode.ExtensionContext) {
    if (!aiOutputChannel) {
        aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem Log"); 
        context.subscriptions.push(aiOutputChannel);
    }
    aiOutputChannel.appendLine('AI Ecosystem Core extension activated.');

    // --- Register ai-ecosystem-core.setLlmApiKey command ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.setLlmApiKey', async () => {
        const config = vscode.workspace.getConfiguration('aiEcosystem.llm');
        const apiKeySecretName = config.get<string>('apiKeySecretName');

        if (!apiKeySecretName) {
            vscode.window.showErrorMessage("LLM API Key secret name is not configured in settings.");
            aiOutputChannel?.appendLine("Error: aiEcosystem.llm.apiKeySecretName is not set in configuration.");
            return;
        }

        const apiKey = await vscode.window.showInputBox({
            prompt: "Enter your LLM API Key",
            password: true,
            ignoreFocusOut: true,
            placeHolder: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        });

        if (apiKey) {
            await context.secrets.store(apiKeySecretName, apiKey);
            vscode.window.showInformationMessage("LLM API Key stored successfully.");
            aiOutputChannel?.appendLine("LLM API Key stored in SecretStorage.");
        } else {
            vscode.window.showInformationMessage("API Key input cancelled.");
        }
    }));


    // --- Register other existing commands (simplified stubs for brevity) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => {vscode.window.showInformationMessage('Hello World!');}));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.validateAgentDefinitions', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => { /* This will be replaced/updated below */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openSimulator', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.generateSystemBlueprint', async () => { /* ... */ }));


    // --- Register ai-ecosystem-core.openPromptEngineerUI command (Updated) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => {
        const columnToShowIn = vscode.window.activeTextEditor?.viewColumn;

        if (promptEngineerPanel) {
            promptEngineerPanel.reveal(columnToShowIn);
            return;
        }

        promptEngineerPanel = vscode.window.createWebviewPanel(
            'promptEngineerUI', 'Prompt Engineering UI', columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')] // Assuming main.js is in webview/
            }
        );

        // Use 'prompt-engineer-ui.html' and 'main.js' from the root of 'webview'
        promptEngineerPanel.webview.html = getWebviewHtml(promptEngineerPanel.webview, context.extensionUri, 'prompt-engineer-ui.html', 'main.js');

        promptEngineerPanel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'sendPrompt':
                        const config = vscode.workspace.getConfiguration('aiEcosystem.llm');
                        const provider = config.get<string>('provider');
                        const modelId = config.get<string>('modelId');
                        const apiKeySecretName = config.get<string>('apiKeySecretName');

                        if (!apiKeySecretName) {
                            promptEngineerPanel?.webview.postMessage({ command: 'showError', text: 'LLM API Key secret name not configured.' });
                            return;
                        }
                        const apiKey = await context.secrets.get(apiKeySecretName);

                        if (!apiKey) {
                            promptEngineerPanel?.webview.postMessage({ command: 'showError', text: 'API Key not set. Use "AI Eco: Set LLM API Key" command.' });
                            return;
                        }

                        let apiUrl = '';
                        let apiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
                        let apiBody: Record<string, any> = {}; // Using Record<string, any> for flexibility
                        const fullPrompt = `${message.promptName}\n\nContext:\n${message.context}`; // Combine prompt and context

                        try {
                            if (provider === 'openai') {
                                apiUrl = 'https://api.openai.com/v1/chat/completions';
                                apiHeaders['Authorization'] = `Bearer ${apiKey}`;
                                apiBody = { model: modelId, messages: [{ role: 'user', content: fullPrompt }] };
                            } else if (provider === 'anthropic') {
                                apiUrl = 'https://api.anthropic.com/v1/messages';
                                apiHeaders['x-api-key'] = apiKey;
                                apiHeaders['anthropic-version'] = '2023-06-01';
                                apiBody = { model: modelId, max_tokens: 2048, messages: [{ role: 'user', content: fullPrompt }] };
                            } else if (provider === 'ollama') {
                                const ollamaBaseUrl = config.get<string>('ollama.baseUrl', 'http://localhost:11434');
                                apiUrl = `${ollamaBaseUrl}/api/chat`; // Or /api/generate for non-chat models
                                // Ollama doesn't typically use API keys in headers for local instances
                                apiBody = { model: modelId, messages: [{ role: 'user', content: fullPrompt }], stream: false };
                            } else {
                                promptEngineerPanel?.webview.postMessage({ command: 'showError', text: `Unsupported LLM provider: ${provider}` });
                                return;
                            }

                            aiOutputChannel?.appendLine(`Sending prompt to ${provider} (${modelId}). API URL: ${apiUrl}`);
                            const response = await axios.post(apiUrl, apiBody, { headers: apiHeaders });
                            
                            let extractedText = '';
                            if (provider === 'openai') {
                                extractedText = response.data.choices?.[0]?.message?.content || JSON.stringify(response.data, null, 2);
                            } else if (provider === 'anthropic') {
                                extractedText = response.data.content?.[0]?.text || JSON.stringify(response.data, null, 2);
                            } else if (provider === 'ollama') {
                                // For chat, response.data.message.content
                                // For generate, response.data.response
                                extractedText = response.data.message?.content || response.data.response || JSON.stringify(response.data, null, 2);
                            }
                            promptEngineerPanel?.webview.postMessage({ command: 'llmResponse', response: extractedText });

                        } catch (error: any) {
                            let errorMessage = 'Unknown error';
                            if (axios.isAxiosError(error)) {
                                if (error.response) {
                                    errorMessage = `API Error ${error.response.status}: ${JSON.stringify(error.response.data, null, 2)}`;
                                } else if (error.request) {
                                    errorMessage = `Network Error: No response received from LLM API. Ensure the service is reachable. URL: ${apiUrl}`;
                                } else {
                                    errorMessage = `Request Setup Error: ${error.message}`;
                                }
                            } else if (error instanceof Error) {
                                errorMessage = error.message;
                            }
                            aiOutputChannel?.appendLine(`LLM API Error: ${errorMessage}`);
                            promptEngineerPanel?.webview.postMessage({ command: 'showError', text: `LLM API Error: ${errorMessage}` });
                        }
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        promptEngineerPanel.onDidDispose(
            () => {
                promptEngineerPanel = undefined;
            },
            null,
            context.subscriptions
        );
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

**`extensions/ai-ecosystem-core/webview/main.js` (No changes needed if it already handles `showError` and `llmResponse`)**
The existing `main.js` for the Prompt Engineering UI should already be capable of:
1.  Sending `promptName` and `context` in the `sendPrompt` message.
2.  Receiving `llmResponse` and displaying `message.response` in the `responseArea`.
3.  Receiving `showError` and displaying `message.text` in the `responseArea` or a dedicated error display area.

If the prompt context was intended to be structured JSON from the UI, then `main.js` might need a `JSON.parse(promptContext.value)` before sending, wrapped in a try-catch. However, the current plan of sending it as a string and appending to the prompt content in `extension.ts` is simpler and works.

**Summary of Changes:**

*   **`package.json`**:
    *   Version incremented to `0.5.0`.
    *   Added configuration settings under `contributes.configuration` for `aiEcosystem.llm.provider`, `aiEcosystem.llm.modelId`, `aiEcosystem.llm.apiKeySecretName`, and `aiEcosystem.llm.ollama.baseUrl`.
    *   Added the `ai-ecosystem-core.setLlmApiKey` command to `contributes.commands` and `activationEvents`.
*   **`src/extension.ts`**:
    *   Added `axios` import.
    *   **`ai-ecosystem-core.setLlmApiKey` Command**:
        *   Prompts for API key using `vscode.window.showInputBox({ password: true })`.
        *   Reads `apiKeySecretName` from settings.
        *   Stores the key in `context.secrets`.
    *   **`ai-ecosystem-core.openPromptEngineerUI` Command's Message Handler for `sendPrompt`**:
        *   Retrieves LLM provider, model ID, and API key secret name from VS Code settings.
        *   Retrieves the actual API key from `context.secrets`.
        *   Handles cases where the API key is not set.
        *   **Provider-Specific API Logic**:
            *   Constructs the appropriate API URL, headers, and body for "openai", "anthropic", and "ollama" providers.
            *   The prompt content sent to the LLM now combines `message.promptName` and `message.context`.
        *   Uses `axios.post` to make the HTTP request.
        *   **Response Handling**: Extracts the text response from the LLM's JSON structure based on the provider.
        *   Sends the extracted text back to the webview using `command: 'llmResponse'`.
        *   **Error Handling**: Catches errors from `axios` (network errors, API errors with status codes and response data) and sends a detailed error message to the webview using `command: 'showError'`.

This implementation provides a functional Prompt Engineering UI that can connect to various LLM backends based on user configuration. The API key is securely stored using VS Code's `SecretStorage`.
