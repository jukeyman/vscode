import * as vscode from 'vscode';
import * as path from 'path'; // Node.js path
import * as fs from 'fs';     // Node.js fs for _getHtmlForWebview sync read
import * as yaml from 'js-yaml'; // js-yaml for parsing blueprint
import { AgentOrchestrator } from '../../../agents/AgentOrchestrator';
import { AgentTask } from '../../../agents/IAgent';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nexus.chatView';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _agentOrchestrator: AgentOrchestrator;
    private _extensionContext: vscode.ExtensionContext;


    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
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
                    const lowerUserMessage = userMessage.toLowerCase();

                    if (lowerUserMessage.startsWith("/design_system") ||
                        lowerUserMessage.startsWith("design a system for") ||
                        lowerUserMessage.startsWith("create a system blueprint for")) {

                        this.triggerArchitectAgent(userMessage);

                    } else if (lowerUserMessage.startsWith("/generate_backend")) {
                        const parts = userMessage.split(/\s+/);
                        if (parts.length < 2) {
                            this.addMessageToChat('system', "Usage: /generate_backend <path_to_blueprint.yaml>");
                            return;
                        }
                        const blueprintPath = parts.slice(1).join(" ");
                        this.addMessageToChat('system', `Received request to generate backend from: ${blueprintPath}`);
                        this.triggerForgeAgent(blueprintPath, "BackendForgeAgent", `Generate backend code for blueprint: ${blueprintPath}`, "backend");
                        return;
                    } else if (lowerUserMessage.startsWith("/generate_frontend")) {
                        const parts = userMessage.split(/\s+/);
                        if (parts.length < 2) {
                            this.addMessageToChat('system', "Usage: /generate_frontend <path_to_blueprint.yaml>");
                            return;
                        }
                        const blueprintPath = parts.slice(1).join(" ");
                        this.addMessageToChat('system', `Received request to generate frontend from: ${blueprintPath}`);
                        this.triggerForgeAgent(blueprintPath, "FrontendForgeAgent", `Generate frontend code for blueprint: ${blueprintPath}`, "frontend");
                        return;
                    } else if (lowerUserMessage.startsWith("/generate_database")) {
                        const parts = userMessage.split(/\s+/);
                        if (parts.length < 2) {
                            this.addMessageToChat('system', "Usage: /generate_database <path_to_blueprint.yaml>");
                            return;
                        }
                        const blueprintPath = parts.slice(1).join(" ");
                        this.addMessageToChat('system', `Received request to generate database artifacts from: ${blueprintPath}`);
                        this.triggerForgeAgent(blueprintPath, "DatabaseForgeAgent", `Generate database artifacts for blueprint: ${blueprintPath}`, "database");
                        return;
                    }
                    else {
                        const mockResponse = `Nexus AI (mock response): You said "${userMessage}". Supported commands: /design_system <description>, /generate_backend <path>, /generate_frontend <path>, /generate_database <path>, /createfile <name> <content>.`;
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
                    this.addMessageToChat('system', 'Welcome to Nexus Chat! Try "/design_system your idea", "/generate_backend blueprints/file.yaml", etc.');
                    break;
            }
        });
    }

    private generateUniqueTaskId(): string {
        return Date.now().toString() + Math.random().toString(36).substring(2);
    }

    private async triggerArchitectAgent(userMessage: string) {
        const taskDescription = `User request for system design: ${userMessage}`;
        const userInputPayload = {
            description: userMessage,
            originalQuery: userMessage
        };

        const task: AgentTask = {
            taskId: this.generateUniqueTaskId(),
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
                        if (!(dirError instanceof vscode.FileSystemError && dirError.code === 'FileExists')) {
                            throw dirError;
                        }
                    }

                    const blueprintName = result.output.blueprintObject?.projectMetadata?.projectName ||
                                          result.output.blueprintObject?.metadata?.blueprintName ||
                                          'generated_blueprint';
                    const safeBlueprintName = blueprintName.replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
                    const timestamp = new Date().toISOString().replace(/[.:TZ]/g, '-').slice(0,-1);
                    const blueprintFileName = `${safeBlueprintName}_${timestamp}.yaml`;
                    const blueprintFilePath = path.join(blueprintsDir, blueprintFileName);

                    await vscode.workspace.fs.writeFile(vscode.Uri.file(blueprintFilePath), Buffer.from(result.output.blueprintYaml, 'utf8'));

                    const relativeBlueprintPath = path.relative(rootPath, blueprintFilePath).replace(/\\/g, '/');
                    this.addMessageToChat('system', `Blueprint saved to: ${relativeBlueprintPath}`);

                    vscode.window.showInformationMessage(`Blueprint saved: ${blueprintFileName}`, 'Open File')
                        .then(selection => {
                            if (selection === 'Open File') {
                                vscode.workspace.openTextDocument(vscode.Uri.file(blueprintFilePath))
                                    .then(doc => vscode.window.showTextDocument(doc));
                            }
                        });
                } else {
                    this.addMessageToChat('system', "Warning: No workspace open. Blueprint YAML was generated but not saved.");
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
    }

    private async triggerForgeAgent(
        blueprintPathRelative: string,
        agentName: "BackendForgeAgent" | "FrontendForgeAgent" | "DatabaseForgeAgent",
        taskDescriptionPrefix: string,
        projectType: "backend" | "frontend" | "database"
    ) {
        const taskId = this.generateUniqueTaskId();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.addMessageToChat('system', `Error: No workspace open. Cannot read blueprint file for ${projectType} generation.`);
            return;
        }
        const workspaceRootPath = workspaceFolders[0].uri.fsPath;
        const blueprintFullPath = path.join(workspaceRootPath, blueprintPathRelative);
        const blueprintUri = vscode.Uri.file(blueprintFullPath);

        let blueprintObject: any;
        try {
            this.addMessageToChat('system', `Reading blueprint: ${blueprintPathRelative} for ${agentName}...`);
            const blueprintContentBytes = await vscode.workspace.fs.readFile(blueprintUri);
            const blueprintContent = Buffer.from(blueprintContentBytes).toString('utf8');
            blueprintObject = yaml.load(blueprintContent);
            if (typeof blueprintObject !== 'object' || blueprintObject === null) {
                throw new Error("Blueprint content is not a valid YAML object.");
            }
            this.addMessageToChat('system', `Blueprint '${blueprintPathRelative}' parsed successfully for ${agentName}.`);
        } catch (e) {
            const error = e as Error;
            this.addMessageToChat('system', `Error reading or parsing blueprint file '${blueprintPathRelative}' for ${agentName}: ${error.message}`);
            console.error(`ChatViewProvider: Error reading/parsing blueprint ${blueprintFullPath} for ${agentName}:`, error);
            return;
        }

        const task: AgentTask = {
            taskId: taskId,
            description: `${taskDescriptionPrefix}: ${blueprintPathRelative}`,
            userInput: { blueprint: blueprintObject }
        };

        this.addMessageToChat('system', `${agentName} is processing blueprint: "${blueprintPathRelative.substring(0,50)}..."`);
        try {
            const result = await this._agentOrchestrator.dispatchTask(task, agentName);

            if (result.status === 'success' && result.output?.fileSet) {
                const fileSet = result.output.fileSet as Record<string, string>;
                const fileCount = Object.keys(fileSet).length;
                this.addMessageToChat('agent', `${agentName}: ${projectType} artifacts (${fileCount} files) generated successfully!`);

                const blueprintName = blueprintObject.projectMetadata?.projectName ||
                                      blueprintObject.metadata?.blueprintName ||
                                      path.basename(blueprintPathRelative, path.extname(blueprintPathRelative));
                const safeBlueprintName = blueprintName.replace(/[^a-z0-9_.-]/gi, '_').toLowerCase();
                const timestamp = new Date().toISOString().replace(/[.:TZ]/g, '-').slice(0,-1);

                // Define base output directory relative to workspace root
                const baseOutputDirRelative = path.join('generated_projects', `${projectType}_${safeBlueprintName}_${timestamp}`);
                const baseOutputDirFull = path.join(workspaceRootPath, baseOutputDirRelative);

                await vscode.workspace.fs.createDirectory(vscode.Uri.file(baseOutputDirFull));
                this.addMessageToChat('system', `Output directory created: ${baseOutputDirRelative.replace(/\\/g, '/')}`);

                let filesWritten = 0;
                for (const relativeFilePathInSet in fileSet) {
                    const fileContent = fileSet[relativeFilePathInSet];
                    // All paths from fileSet are relative to the root of the generated project structure
                    const absoluteFilePath = path.join(baseOutputDirFull, relativeFilePathInSet);
                    const fileDir = path.dirname(absoluteFilePath);

                    try {
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(fileDir));
                        await vscode.workspace.fs.writeFile(vscode.Uri.file(absoluteFilePath), Buffer.from(fileContent, 'utf8'));
                        filesWritten++;
                    } catch (fileWriteError) {
                        const fwe = fileWriteError as Error;
                        this.addMessageToChat('system', `Error writing file ${relativeFilePathInSet}: ${fwe.message}`);
                        console.error(`Error writing file ${absoluteFilePath}:`, fwe);
                    }
                }
                this.addMessageToChat('system', `${projectType} artifacts (${filesWritten}/${fileCount} files) saved to: ${baseOutputDirRelative.replace(/\\/g, '/')}`);
                vscode.window.showInformationMessage(`${projectType} artifacts generated in ${baseOutputDirRelative}.`);

            } else {
                const errorDetail = result.error || `Unknown error from ${agentName}.`;
                this.addMessageToChat('agent', `${agentName} Error: ${errorDetail}`);
                if (result.output?.rawOutput) {
                    this.addMessageToChat('system', `Debug: Raw LLM output (first 500 chars):\n${String(result.output.rawOutput).substring(0, 500)}...`);
                }
            }
        } catch (e) {
            const error = e as Error;
            this.addMessageToChat('system', `Error dispatching task to ${agentName}: ${error.message}`);
            console.error(`ChatViewProvider: Error dispatching to ${agentName}:`, error);
        }
    }


    public addMessageToChat(sender: 'user' | 'agent' | 'system', text: string): void {
        if (this._view) {
            this._view.webview.postMessage({ command: 'addChatMessage', sender, text });
        } else {
            console.warn("ChatViewProvider: Attempted to add message, but webview is not available.");
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
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
