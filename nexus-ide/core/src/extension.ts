import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
// AI Engine Components
import { ModelManager } from './nexus/ai/ModelManager';
import { ModelRouter } from './nexus/ai/ModelRouter';
// Context System
import { QuantumContext } from './nexus/context/QuantumContext';
// Agent Framework
import { AgentBus } from './nexus/agents/AgentBus';
import { AgentOrchestrator } from './nexus/agents/AgentOrchestrator';
import { ArchitectAgent } from './nexus/agents/personas/ArchitectAgent';
// UI Components
import { ChatViewProvider } from './nexus/ui/webviews/chat/ChatViewProvider';

// Other imports from previous steps (axios, EventSource, cp, etc.) would be here if used by helper functions
import { randomBytes } from 'crypto'; // For getNonce if used here
import * as cp from 'child_process'; // For simulationServiceProcess
import axios from 'axios'; // For simulationServiceProcess health check
import EventSource from 'eventsource'; // For activeSseConnections

// Global variables
const SIMULATION_SERVICE_URL = 'http://localhost:8123';
let simulationServiceProcess: cp.ChildProcess | null = null;
const activeSseConnections: Map<string, EventSource> = new Map();
let serviceOutputChannel: vscode.OutputChannel | undefined;
let aiOutputChannel: vscode.OutputChannel | undefined;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanelSimulationId: string | null = null;

// Helper function to get nonce (if needed directly in this file for other webviews)
function getNonce() {
    return randomBytes(16).toString('base64');
}

// Generalized getWebviewHtml function (needed for any webview panels directly managed here)
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, htmlSubPath: string, jsFileName: string): string {
    const htmlDiskPath = vscode.Uri.joinPath(extensionUri, 'out', 'webviews', htmlSubPath);
    let htmlContent = "";
    try {
        htmlContent = fs.readFileSync(htmlDiskPath.fsPath, 'utf8');
    } catch (err) {
        console.error(`Error reading HTML file ${htmlDiskPath.fsPath}:`, err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        return `<html><body>Error loading webview content from ${htmlDiskPath.fsPath}. Error: ${errorMsg}</body></html>`;
    }
    const scriptDiskPath = vscode.Uri.joinPath(extensionUri, 'out', 'webviews', nodePath.dirname(htmlSubPath), jsFileName);
    const scriptUri = webview.asWebviewUri(scriptDiskPath);
    const nonce = getNonce();
    htmlContent = htmlContent.replace(/\$\{webview\.cspSource\}/g, webview.cspSource);
    htmlContent = htmlContent.replace(new RegExp('\\$\\{nonce\\}', 'g'), nonce);
    htmlContent = htmlContent.replace(/\$\{scriptUri\}/g, scriptUri.toString());

    // If chat.css is also in 'out/webviews/chat' and referenced in chat.html as ${stylesUri}
    const stylesPathOnDisk = vscode.Uri.joinPath(extensionUri, 'out', 'webviews', nodePath.dirname(htmlSubPath), 'chat.css');
    if (fs.existsSync(stylesPathOnDisk.fsPath)) {
        const stylesUri = webview.asWebviewUri(stylesPathOnDisk);
        htmlContent = htmlContent.replace(/\$\{stylesUri\}/g, stylesUri.toString());
    } else {
        // Fallback or remove if CSS is optional or handled differently
        htmlContent = htmlContent.replace(/<link href="\$\{stylesUri\}" rel="stylesheet">/g, '<!-- Stylesheet not found -->');
    }
    return htmlContent;
}


export async function activate(context: vscode.ExtensionContext) {
    if (!aiOutputChannel) {
        aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem Log");
        context.subscriptions.push(aiOutputChannel);
    }
    aiOutputChannel.appendLine('Nexus IDE - AI Ecosystem Core activating...');

    const modelManager = new ModelManager();
    // TODO: Implement settings provider and call modelManager.loadModelsFromSettings()
    // For now, manually register a model or ensure ModelManager has defaults if needed.
    // Example: if (modelManager.listRegisteredModels().length === 0) {
    //     modelManager.registerModel('ollama', { modelId: 'llama3', baseUrl: 'http://localhost:11434' }, 'default_ollama');
    // }
    aiOutputChannel.appendLine('ModelManager initialized.');

    const modelRouter = new ModelRouter(modelManager);
    aiOutputChannel.appendLine('ModelRouter initialized.');

    const quantumContext = new QuantumContext();
    // await quantumContext.initialize(context.extensionUri); // If it has an async init
    aiOutputChannel.appendLine('QuantumContext initialized.');

    const agentBus = new AgentBus();
    aiOutputChannel.appendLine('AgentBus initialized.');

    const agentOrchestrator = new AgentOrchestrator(agentBus, quantumContext, modelRouter);
    aiOutputChannel.appendLine('AgentOrchestrator initialized.');

    const architectAgent = new ArchitectAgent(modelRouter);
    try {
        await architectAgent.initialize(context.extensionUri);
        agentOrchestrator.registerAgent(architectAgent);
        aiOutputChannel.appendLine('ArchitectAgent registered successfully.');
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        aiOutputChannel.appendLine(`Failed to initialize or register ArchitectAgent: ${errorMsg}`);
        vscode.window.showErrorMessage(`ArchitectAgent could not be initialized: ${errorMsg}`);
    }

    // Initialize Chat View Provider
    // Note: ChatViewProvider's _getHtmlForWebview now uses 'out/webviews/chat' as base
    // The general getWebviewHtml defined here also assumes 'out/webviews' then subpath.
    const chatViewProvider = new ChatViewProvider(context, agentOrchestrator);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );
    aiOutputChannel.appendLine('ChatViewProvider registered.');

    // Register other commands (ensure full implementations are present from previous steps)
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => {
        vscode.window.showInformationMessage('Hello from Nexus AI Ecosystem!');
        aiOutputChannel.appendLine("Hello World command executed.");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.setLlmApiKey', async () => {
        const config = vscode.workspace.getConfiguration('aiEcosystem.llm');
        const apiKeySecretName = config.get<string>('apiKeySecretName');
        if (!apiKeySecretName) {
            vscode.window.showErrorMessage("LLM API Key secret name not configured."); return;
        }
        const apiKey = await vscode.window.showInputBox({ prompt: "Enter LLM API Key", password: true });
        if (apiKey) {
            await context.secrets.store(apiKeySecretName, apiKey);
            vscode.window.showInformationMessage("LLM API Key stored.");
        }
    }));

    // Placeholder for other command registrations from your project if they exist:
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.validateAgentDefinitions', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openSimulator', async () => { /* ... */ }));
    // context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.generateSystemBlueprint', async () => { /* ... */ }));


    aiOutputChannel.appendLine('Nexus IDE - AI Ecosystem Core activation completed.');
}

export function deactivate() {
    aiOutputChannel?.appendLine("Deactivating AI Ecosystem Core extension.");
    activeSseConnections.forEach((sse, simId) => {
        sse.close();
        // Optionally send stop command
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
