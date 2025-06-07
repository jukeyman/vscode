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
import { BackendForgeAgent } from './nexus/agents/personas/BackendForgeAgent';
import { FrontendForgeAgent } from './nexus/agents/personas/FrontendForgeAgent';
import { DatabaseForgeAgent } from './nexus/agents/personas/DatabaseForgeAgent';
import { InfrastructureForgeAgent } from './nexus/agents/personas/InfrastructureForgeAgent';
import { TestingForgeAgent } from './nexus/agents/personas/TestingForgeAgent';
import { DocumentationForgeAgent } from './nexus/agents/personas/DocumentationForgeAgent'; // Added DocumentationForgeAgent
// UI Components
import { ChatViewProvider } from './nexus/ui/webviews/chat/ChatViewProvider';

// Other imports from previous steps (axios, EventSource, cp, etc.) would be here if used by helper functions
import { randomBytes } from 'crypto';
import * as cp from 'child_process';
import axios from 'axios';
import EventSource from 'eventsource';

// Global variables
const SIMULATION_SERVICE_URL = 'http://localhost:8123';
let simulationServiceProcess: cp.ChildProcess | null = null;
const activeSseConnections: Map<string, EventSource> = new Map();
let serviceOutputChannel: vscode.OutputChannel | undefined;
let aiOutputChannel: vscode.OutputChannel | undefined;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanelSimulationId: string | null = null;

// Helper function to get nonce
function getNonce() {
    return randomBytes(16).toString('base64');
}

// Generalized getWebviewHtml function
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

    const stylesPathOnDisk = vscode.Uri.joinPath(extensionUri, 'out', 'webviews', nodePath.dirname(htmlSubPath), 'chat.css');
    if (htmlSubPath.startsWith('chat') && fs.existsSync(stylesPathOnDisk.fsPath)) {
        const stylesUri = webview.asWebviewUri(stylesPathOnDisk);
        htmlContent = htmlContent.replace(/\$\{stylesUri\}/g, stylesUri.toString());
    } else {
        htmlContent = htmlContent.replace(/<link href="\$\{stylesUri\}" rel="stylesheet">/g, '<!-- Stylesheet not applicable or not found -->');
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
    aiOutputChannel.appendLine('ModelManager initialized.');

    const modelRouter = new ModelRouter(modelManager);
    aiOutputChannel.appendLine('ModelRouter initialized.');

    const quantumContext = new QuantumContext();
    aiOutputChannel.appendLine('QuantumContext initialized.');

    const agentBus = new AgentBus();
    aiOutputChannel.appendLine('AgentBus initialized.');

    const agentOrchestrator = new AgentOrchestrator(agentBus, quantumContext, modelRouter);
    aiOutputChannel.appendLine('AgentOrchestrator initialized.');

    // Instantiate and Register Agents
    const agentsToRegister = [
        { name: 'ArchitectAgent', constructor: ArchitectAgent },
        { name: 'BackendForgeAgent', constructor: BackendForgeAgent },
        { name: 'FrontendForgeAgent', constructor: FrontendForgeAgent },
        { name: 'DatabaseForgeAgent', constructor: DatabaseForgeAgent },
        { name: 'InfrastructureForgeAgent', constructor: InfrastructureForgeAgent },
        { name: 'TestingForgeAgent', constructor: TestingForgeAgent },
        { name: 'DocumentationForgeAgent', constructor: DocumentationForgeAgent }
    ];

    for (const agentInfo of agentsToRegister) {
        const agentInstance = new agentInfo.constructor(modelRouter);
        try {
            // Assuming initialize method accepts extensionUri for path resolutions
            if (typeof agentInstance.initialize === 'function') {
                 await agentInstance.initialize(context.extensionUri);
            }
            agentOrchestrator.registerAgent(agentInstance);
            aiOutputChannel.appendLine(`${agentInfo.name} registered successfully.`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            aiOutputChannel.appendLine(`Failed to initialize or register ${agentInfo.name}: ${errorMsg}`);
            vscode.window.showErrorMessage(`${agentInfo.name} could not be initialized: ${errorMsg}`);
        }
    }

    // Initialize Chat View Provider
    const chatViewProvider = new ChatViewProvider(context, agentOrchestrator);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );
    aiOutputChannel.appendLine('ChatViewProvider registered.');

    // Register other commands
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

    // Stubs for other commands from previous phases - ensure their full implementations are present
    // ... (other commands)

    aiOutputChannel.appendLine('Nexus IDE - AI Ecosystem Core activation completed.');
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

**2. `nexus-ide/core/src/nexus/agents/AgentOrchestrator.ts`**
