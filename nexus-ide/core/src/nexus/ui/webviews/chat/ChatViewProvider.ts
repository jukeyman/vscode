import * as vscode from 'vscode';
import * as path from 'path'; // Node.js path
import * as fs from 'fs';     // Node.js fs
// import { AgentOrchestrator } from '../../../agents/AgentOrchestrator'; // Future
// import { AgentTask } from '../../../agents/IAgent'; // Future

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nexus.chatView';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    // private _agentOrchestrator: AgentOrchestrator; // Future

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        // agentOrchestrator: AgentOrchestrator // Future
    ) {
        this._extensionUri = extensionContext.extensionUri;
        // this._agentOrchestrator = agentOrchestrator; // Future
        console.log("ChatViewProvider initialized.");
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
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat'), // For compiled JS/CSS
                vscode.Uri.joinPath(this._extensionUri, 'media') // If you have other media assets
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            console.log(`ChatViewProvider received message: ${message.command}`);
            switch (message.command) {
                case 'sendMessageToAgent':
                    const userMessage = message.text;
                    this.addMessageToChat('user', userMessage);

                    // TODO: Construct AgentTask and send to AgentOrchestrator
                    // const task: AgentTask = { 
                    //     taskId: new Date().getTime().toString(), 
                    //     description: "Process chat input from Nexus Chat UI", 
                    //     userInput: userMessage,
                    //     priority: 'medium'
                    // };
                    // try {
                    //     // const result = await this._agentOrchestrator.dispatchTask(task);
                    //     // this.addMessageToChat('agent', result.output || JSON.stringify(result));
                    // } catch (e) {
                    //     const error = e as Error;
                    //     this.addMessageToChat('system', `Error dispatching task: ${error.message}`);
                    // }

                    // Mock response for now:
                    setTimeout(() => { // Simulate delay
                        const mockResponse = `Nexus AI (mock): Thanks for your message - "${userMessage}". I'm still learning to process this fully.`;
                        this.addMessageToChat('agent', mockResponse);
                    }, 500);
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
                
                case 'webviewReady': // Message from webview when it's loaded
                    console.log("ChatViewProvider: Webview reported ready.");
                    this.addMessageToChat('system', 'Welcome to Nexus Chat! How can I assist you today?');
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
        // This assumes the HTML file is copied to 'out/webviews/chat' during build
        const htmlFilePath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.html');
        
        // Paths to JS and CSS files also in 'out/webviews/chat'
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.js');
        const stylesPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'out', 'webviews', 'chat', 'chat.css');

        // Convert to webview URIs
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
        const stylesUri = webview.asWebviewUri(stylesPathOnDisk);

        // Generate a nonce for CSP
        const nonce = this.getNonce();

        let htmlContent = "";
        try {
            htmlContent = fs.readFileSync(htmlFilePath.fsPath, 'utf8');
        } catch (err) {
            console.error("Error reading chat.html:", err);
            return `<html><body><h1>Error loading chat interface</h1><p>${(err as Error).message}</p></body></html>`;
        }
        
        // Replace placeholders
        htmlContent = htmlContent.replace(/\$\{webview\.cspSource\}/g, webview.cspSource);
        htmlContent = htmlContent.replace(new RegExp('\\$\\{nonce\\}', 'g'), nonce); // Global replace for multiple nonces
        htmlContent = htmlContent.replace(/\$\{stylesUri\}/g, stylesUri.toString());
        htmlContent = htmlContent.replace(/\$\{scriptUri\}/g, scriptUri.toString());

        return htmlContent;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
```
