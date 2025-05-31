import * as vscode from 'vscode';
import * as path from 'path'; // Node.js path
import * as fs from 'fs';     // Node.js fs for _getHtmlForWebview sync read
import { AgentOrchestrator } from '../../../agents/AgentOrchestrator'; // Adjusted path
import { AgentTask } from '../../../agents/IAgent'; // Adjusted path

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nexus.chatView';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _agentOrchestrator: AgentOrchestrator;
    private _extensionContext: vscode.ExtensionContext;


    constructor(
        private readonly extensionContext: vscode.ExtensionContext, // Keep original context for general use
        agentOrchestrator: AgentOrchestrator
    ) {
        this._extensionContext = extensionContext;
        this._extensionUri = extensionContext.extensionUri;
        this._agentOrchestrator = agentOrchestrator;
        console.log("ChatViewProvider initialized with AgentOrchestrator.");
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                // Assuming compiled JS/CSS for webviews are in 'out/webviews/chat'
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat'),
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            console.log(`ChatViewProvider received message: ${message.command}`);
            switch (message.command) {
                case 'sendMessageToAgent':
                    const userMessage = message.text;
                    this.addMessageToChat('user', userMessage);

                    // Simple intent detection for system design
                    if (userMessage.toLowerCase().startsWith("/design_system") ||
                        userMessage.toLowerCase().startsWith("design a system for") ||
                        userMessage.toLowerCase().startsWith("create a system blueprint for")) {

                        const taskDescription = `User request for system design: ${userMessage}`;
                        const userInputPayload = {
                            description: userMessage, // The full user prompt is the main description
                            originalQuery: userMessage
                        };

                        const task: AgentTask = {
                            taskId: Date.now().toString() + Math.random().toString(36).substring(2),
                            description: taskDescription,
                            userInput: userInputPayload,
                            priority: 'medium'
                        };

                        this.addMessageToChat('system', `ArchitectAgent is processing your design request: "${userMessage.substring(0, 50)}..."`);

                        try {
                            const result = await this._agentOrchestrator.dispatchTask(task, "ArchitectAgent");

                            if (result.status === 'success' && result.output?.blueprintYaml && result.output?.blueprintObject) {
                                this.addMessageToChat('agent', "ArchitectAgent: System blueprint generated successfully!");

                                const workspaceFolders = vscode.workspace.workspaceFolders;
                                if (workspaceFolders && workspaceFolders.length > 0) {
                                    const rootPath = workspaceFolders[0].uri.fsPath;
                                    const blueprintsDir = path.join(rootPath, 'blueprints');

                                    try {
                                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(blueprintsDir));
                                    } catch (dirError) {
                                        // Ignore if directory already exists, error on other issues
                                        if (!(dirError instanceof vscode.FileSystemError && dirError.code === 'FileExists')) {
                                            throw dirError; // Re-throw if it's not a 'FileExists' error
                                        }
                                    }

                                    const blueprintName = result.output.blueprintObject?.projectMetadata?.projectName || 'generated_blueprint';
                                    const safeBlueprintName = blueprintName.replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
                                    const timestamp = new Date().toISOString().replace(/[.:T]/g, '-').slice(0,-5); // Adjusted timestamp format
                                    const blueprintFileName = `${safeBlueprintName}_${timestamp}.yaml`;
                                    const blueprintFilePath = path.join(blueprintsDir, blueprintFileName);

                                    await vscode.workspace.fs.writeFile(vscode.Uri.file(blueprintFilePath), Buffer.from(result.output.blueprintYaml, 'utf8'));

                                    const relativeBlueprintPath = path.relative(rootPath, blueprintFilePath);
                                    this.addMessageToChat('system', `Blueprint saved to: ${relativeBlueprintPath}`);

                                    vscode.window.showInformationMessage(`Blueprint saved: ${blueprintFileName}`, 'Open File')
                                        .then(selection => {
                                            if (selection === 'Open File') {
                                                vscode.workspace.openTextDocument(vscode.Uri.file(blueprintFilePath))
                                                    .then(doc => vscode.window.showTextDocument(doc));
                                            }
                                        });

                                } else {
                                    this.addMessageToChat('system', "Warning: No workspace open. Blueprint YAML was generated but not saved to a file.");
                                    this.addMessageToChat('agent', "Generated Blueprint YAML:\n" + result.output.blueprintYaml);
                                }

                            } else {
                                const errorDetail = result.error || 'Unknown error from ArchitectAgent.';
                                this.addMessageToChat('agent', `ArchitectAgent Error: ${errorDetail}`);
                                if (result.output?.rawOutput) {
                                    this.addMessageToChat('system', `Debug: Raw LLM output (first 500 chars):\n${String(result.output.rawOutput).substring(0, 500)}...`);
                                }
                                if (result.output?.validationErrors) {
                                    this.addMessageToChat('system', `Debug: Validation errors:\n${JSON.stringify(result.output.validationErrors, null, 2)}`);
                                }
                            }
                        } catch (e) {
                            const error = e as Error;
                            this.addMessageToChat('system', `Error dispatching task to ArchitectAgent: ${error.message}`);
                            console.error("ChatViewProvider: Error dispatching to ArchitectAgent:", error);
                        }

                    } else {
                        // Default mock response for other messages
                        const mockResponse = `Nexus AI (mock response): You said "${userMessage}". Full agent routing for general queries is pending.`;
                        this.addMessageToChat('agent', mockResponse);
                    }
                    break;

                case 'createFileRequest':
                    const { fileName, content } = message.data;
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        const rootPath = workspaceFolders[0].uri;
                        const filePath = vscode.Uri.joinPath(rootPath, fileName);
                        try {
                            await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf8'));
                            this.addMessageToChat('system', `File created: ${fileName}`);
                            console.log(`ChatViewProvider: File created at ${filePath.fsPath}`);
                        } catch (e) {
                            const error = e as Error;
                            this.addMessageToChat('system', `Error creating file ${fileName}: ${error.message}`);
                            console.error(`ChatViewProvider: Error creating file ${fileName}:`, error);
                        }
                    } else {
                        this.addMessageToChat('system', "No workspace open. Cannot create file.");
                        console.warn("ChatViewProvider: No workspace open to create file.");
                    }
                    break;

                case 'webviewReady':
                    console.log("ChatViewProvider: Webview reported ready.");
                    this.addMessageToChat('system', 'Welcome to Nexus Chat! Try "design a system for an online bookstore" or "/createfile test.txt Hello Nexus".');
                    break;
            }
        });
    }

    public addMessageToChat(sender: 'user' | 'agent' | 'system', text: string): void {
        if (this._view) {
            this._view.webview.postMessage({ command: 'addChatMessage', sender, text });
        } else {
            console.warn("ChatViewProvider: Attempted to add message, but webview is not available.");
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Path to the HTML file within the extension's directory
        // This assumes compiled webview assets are in 'out/webviews/chat/'
        const htmlFilePathDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.html');

        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.js');
        const stylesPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.css');

        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
        const stylesUri = webview.asWebviewUri(stylesPathOnDisk);

        const nonce = this.getNonce();

        let htmlContent = "";
        try {
            htmlContent = fs.readFileSync(htmlFilePathDisk.fsPath, 'utf8');
        } catch (err) {
            console.error("Error reading chat.html:", err);
            return `<html><body><h1>Error loading chat interface</h1><p>${(err as Error).message}</p></body></html>`;
        }

        htmlContent = htmlContent.replace(/\$\{webview\.cspSource\}/g, webview.cspSource);
        htmlContent = htmlContent.replace(new RegExp('\\$\\{nonce\\}', 'g'), nonce);
        htmlContent = htmlContent.replace(/\$\{stylesUri\}/g, stylesUri.toString());
        htmlContent = htmlContent.replace(/\$\{scriptUri\}/g, scriptUri.toString());

        return htmlContent;
    }

    private getNonce() { // Copied from extension.ts if not already shared
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
```
