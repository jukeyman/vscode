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
            aiOutputChannel?.appendLine("Simulation service already running and responsive.");
            return true;
        } catch (e) {
            aiOutputChannel?.appendLine("Simulation service process exists but is not responsive. Attempting to restart.");
            simulationServiceProcess.kill(); 
            simulationServiceProcess = null; 
        }
    }

    if (!serviceOutputChannel) {
        serviceOutputChannel = vscode.window.createOutputChannel("Simulation Service Logs");
        context.subscriptions.push(serviceOutputChannel);
    }
    serviceOutputChannel.show(true); 
    serviceOutputChannel.appendLine("Attempting to start Python simulation service...");

    const workspaceRootPath = getWorkspaceRootPath();
    if (!workspaceRootPath) {
        serviceOutputChannel.appendLine("Error: No workspace open. Cannot determine CWD for simulation service.");
        vscode.window.showErrorMessage("No workspace open. Cannot start simulation service.");
        return false;
    }
    
    const serviceDir = nodePath.join(workspaceRootPath, 'simulation_service');
    const serviceMainPy = nodePath.join(serviceDir, 'main.py');

    if (!fs.existsSync(serviceMainPy)) {
        serviceOutputChannel.appendLine(`Error: Simulation service main.py not found at ${serviceMainPy}`);
        vscode.window.showErrorMessage(`Simulation service main.py not found at expected location: ${serviceMainPy}`);
        return false;
    }

    simulationServiceProcess = cp.spawn(
        'uvicorn', 
        ['main:app', '--host', '127.0.0.1', '--port', '8123'], 
        { 
            cwd: serviceDir, 
            shell: true, 
            detached: false 
        }
    );

    simulationServiceProcess.stdout?.on('data', (data) => {
        serviceOutputChannel?.appendLine(`Service: ${data.toString().trim()}`);
    });
    simulationServiceProcess.stderr?.on('data', (data) => {
        serviceOutputChannel?.appendLine(`Service ERR: ${data.toString().trim()}`);
    });
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
                if (simulationServiceProcess && !simulationServiceProcess.killed) {
                    simulationServiceProcess.kill();
                }
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

    // --- Register other existing commands (simplified stubs for brevity) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => {vscode.window.showInformationMessage('Hello World!');}));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.validateAgentDefinitions', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => { /* ... */ }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => { /* ... */ }));


    // --- Register ai-ecosystem-core.openSimulator command ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openSimulator', async () => {
        const columnToShowIn = vscode.window.activeTextEditor?.viewColumn;

        if (simulatorPanel) {
            simulatorPanel.reveal(columnToShowIn);
            return;
        }

        simulatorPanel = vscode.window.createWebviewPanel(
            'agentSimulator', '🧪 Agent Simulator', columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'webview'),
                    vscode.Uri.joinPath(context.extensionUri, 'webview', 'simulator')
                ]
            }
        );

        simulatorPanel.webview.html = getWebviewHtml(simulatorPanel.webview, context.extensionUri, 'simulator/simulator-ui.html', 'simulator-main.js');

        // Handle messages from the webview
        simulatorPanel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'uiReady':
                        try {
                            const agentUris = await findAgentDefinitionFiles();
                            const workspaceRootPath = getWorkspaceRootPath() || ''; 
                            const agentList = agentUris.map(uri => ({
                                id: nodePath.relative(workspaceRootPath, uri.fsPath).replace(/\\/g, '/'), 
                                name: nodePath.basename(uri.fsPath) + ` (${nodePath.relative(workspaceRootPath, uri.fsPath).replace(/\\/g, '/')})`
                            }));
                            simulatorPanel?.webview.postMessage({ command: 'populateAgentSelector', agents: agentList });
                        } catch (e) { 
                            const errorMsg = e instanceof Error ? e.message : String(e);
                            aiOutputChannel?.appendLine(`Error finding agent definitions: ${errorMsg}`);
                            vscode.window.showErrorMessage(`Error finding agent definitions: ${errorMsg}`);
                         }
                        return;

                    case 'runSimulation':
                        aiOutputChannel?.appendLine(`UI: Run simulation. Agent=${message.agentId}, Input=${message.initialInput}`);
                        const serviceRunning = await ensureSimulationServiceIsRunning(context);
                        if (!serviceRunning) {
                            vscode.window.showErrorMessage("Failed to start/connect to simulation service. Cannot run simulation.");
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'error', message: 'Service not available.' });
                            return;
                        }

                        if (simulatorPanelSimulationId) { 
                            const oldSse = activeSseConnections.get(simulatorPanelSimulationId);
                            if (oldSse) {
                                oldSse.close();
                                activeSseConnections.delete(simulatorPanelSimulationId);
                                aiOutputChannel?.appendLine(`Closed previous SSE for sim ID: ${simulatorPanelSimulationId}`);
                            }
                        }
                        
                        try {
                            const agentIdForService = message.agentId; 
                            const response = await axios.post(`${SIMULATION_SERVICE_URL}/simulations`, {
                                agentId: agentIdForService, 
                                initialInput: message.initialInput,
                                mockConfigurations: message.mockConfigs || {} // Ensure this is sent if UI supports it
                            });
                            
                            const simulationId = response.data.simulationId;
                            simulatorPanelSimulationId = simulationId; 
                            aiOutputChannel?.appendLine(`Simulation created with ID: ${simulationId}`);
                            // Initial state update to webview
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'running', message: 'Simulation started.' });

                            const eventSourceUrl = `${SIMULATION_SERVICE_URL}/simulations/${simulationId}/events`;
                            const eventSource = new EventSource(eventSourceUrl);
                            activeSseConnections.set(simulationId, eventSource);
                            aiOutputChannel?.appendLine(`SSE connection established to: ${eventSourceUrl}`);

                            eventSource.onmessage = (event) => {
                                try {
                                    const serverEvent = JSON.parse(event.data);
                                    // Forward all service events as trace events
                                    simulatorPanel?.webview.postMessage({ command: 'traceEvent', event: serverEvent });
                                    
                                    // Specifically handle status_update events from service to update UI state
                                    if (serverEvent.type === 'status_update' && serverEvent.data?.state) {
                                        const newState = serverEvent.data.state;
                                        const statusMessage = serverEvent.data.message || `State changed to ${newState}`;
                                        simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: newState, message: statusMessage });
                                        aiOutputChannel?.appendLine(`SSE: Received status_update, new state: ${newState} for sim ${simulationId}. Message: ${statusMessage}`);
                                        
                                        if (['stopped', 'completed', 'error'].includes(newState)) {
                                            eventSource.close(); 
                                            activeSseConnections.delete(simulationId);
                                            if (simulatorPanelSimulationId === simulationId) simulatorPanelSimulationId = null;
                                            aiOutputChannel?.appendLine(`SSE connection closed for sim ${simulationId} due to terminal state: ${newState}`);
                                        }
                                    }
                                } catch (e) {
                                    aiOutputChannel?.appendLine(`Error parsing SSE message: ${e} - Data: ${event.data}`);
                                }
                            };
                            eventSource.onerror = (err) => {
                                aiOutputChannel?.appendLine(`SSE Error for sim ${simulationId}: ${JSON.stringify(err)}`);
                                eventSource.close();
                                activeSseConnections.delete(simulationId);
                                if (simulatorPanelSimulationId === simulationId) {
                                   simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'error', message: 'SSE connection error.' });
                                   simulatorPanelSimulationId = null;
                                }
                            };
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            aiOutputChannel?.appendLine(`Error creating simulation: ${errorMsg}`);
                            vscode.window.showErrorMessage(`Failed to run simulation: ${errorMsg}`);
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'error', message: `Failed to run: ${errorMsg}` });
                        }
                        return;

                    case 'controlSimulation':
                        const action = message.action;
                        const simIdToControl = simulatorPanelSimulationId;

                        if (!simIdToControl) {
                            vscode.window.showWarningMessage("No active simulation associated with this panel to control.");
                             simulatorPanel?.webview.postMessage({ command: 'showError', text: 'No active simulation to control.'}); 
                            return;
                        }
                        aiOutputChannel?.appendLine(`UI: Control command '${action}' for simulation ID: ${simIdToControl}`);
                        try {
                            const controlResponse = await axios.post(`${SIMULATION_SERVICE_URL}/simulations/${simIdToControl}/control`, {
                                command: action
                            });
                            aiOutputChannel?.appendLine(`Control command '${action}' sent. Service response: ${JSON.stringify(controlResponse.data)}`);
                            
                            // Log acknowledgement. Actual state change comes from SSE status_update.
                            if(controlResponse.data.status === "success") {
                                simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: `Control command '${action}' acknowledged by service. ${controlResponse.data.message || ''}` });
                            } else {
                                 simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: `Control command '${action}' processed by service with message: ${controlResponse.data.message || 'No specific message.'}`, logType: 'WARNING' });
                            }

                            // Proactive cleanup for 'stop' if service doesn't immediately send terminal status_update
                            if (action === 'stop') {
                                const sse = activeSseConnections.get(simIdToControl);
                                if (sse) {
                                    sse.close();
                                    activeSseConnections.delete(simIdToControl);
                                    aiOutputChannel?.appendLine(`SSE connection explicitly closed for stopped simulation: ${simIdToControl}`);
                                }
                                if (simulatorPanelSimulationId === simIdToControl) {
                                    // This ensures UI updates even if service's final 'stopped' event is missed/delayed
                                    simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'stopped', message: 'Simulation stopped by user.' });
                                    simulatorPanelSimulationId = null;
                                }
                            }
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            aiOutputChannel?.appendLine(`Error sending control '${action}' for ${simIdToControl}: ${errorMsg}`);
                            vscode.window.showErrorMessage(`Failed to ${action} simulation: ${errorMsg}`);
                            simulatorPanel?.webview.postMessage({ command: 'showError', text: `Failed to ${action} simulation: ${errorMsg}` });
                        }
                        return;
                    
                    case 'showErrorUser': 
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        simulatorPanel.onDidDispose(
            () => {
                if (simulatorPanelSimulationId) {
                    const sse = activeSseConnections.get(simulatorPanelSimulationId);
                    if (sse) {
                        aiOutputChannel?.appendLine(`Simulator panel closed. Closing SSE for sim: ${simulatorPanelSimulationId}`);
                        sse.close();
                        activeSseConnections.delete(simulatorPanelSimulationId);
                        axios.post(`${SIMULATION_SERVICE_URL}/simulations/${simulatorPanelSimulationId}/control`, { command: 'stop' })
                            .catch(err => aiOutputChannel?.appendLine(`Error stopping sim ${simulatorPanelSimulationId} on panel close: ${err}`));
                    }
                    simulatorPanelSimulationId = null;
                }
                simulatorPanel = undefined;
            },
            null,
            context.subscriptions
        );
    }));
}

export function deactivate() {
    aiOutputChannel?.appendLine("Deactivating AI Ecosystem Core extension.");
    activeSseConnections.forEach((sse, simId) => {
        aiOutputChannel?.appendLine(`Closing SSE connection for simulation: ${simId}`);
        sse.close();
        axios.post(`${SIMULATION_SERVICE_URL}/simulations/${simId}/control`, { command: 'stop' })
             .catch(err => aiOutputChannel?.appendLine(`Error stopping sim ${simId} on deactivate: ${err}`));
    });
    activeSseConnections.clear();

    if (simulationServiceProcess && !simulationServiceProcess.killed) {
        aiOutputChannel?.appendLine("Terminating simulation service process.");
        const killed = simulationServiceProcess.kill(); 
        if (!killed) {
            aiOutputChannel?.appendLine("Failed to kill simulation service with SIGTERM. Attempting SIGKILL.");
            simulationServiceProcess.kill('SIGKILL');
        }
        simulationServiceProcess = null;
    }
    
    aiOutputChannel?.dispose();
    serviceOutputChannel?.dispose(); 
    promptEngineerPanel?.dispose();
    simulatorPanel?.dispose(); 
}
```

**`extensions/ai-ecosystem-core/webview/simulator/simulator-main.js`**
