import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import Ajv, { Schema } from 'ajv';
import * as yaml from 'js-yaml';
import { randomBytes } from 'crypto';

// Global variables
let aiOutputChannel: vscode.OutputChannel | undefined;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;
let simulatorPanel: vscode.WebviewPanel | undefined = undefined; // For the Agent Simulator

// Helper function to get workspace root URI
function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

// Helper function to get workspace root path
function getWorkspaceRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Helper function to get nonce (from previous step)
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
    htmlContent = htmlContent.replace(new RegExp('\\$\\{nonce\\}', 'g'), nonce); // Ensure all nonces are replaced
    htmlContent = htmlContent.replace(/\$\{scriptUri\}/g, scriptUri.toString());
    
    return htmlContent;
}

// Helper function to find agent definition files (simplified, assume it exists from previous steps)
async function findAgentDefinitionFiles(): Promise<vscode.Uri[]> {
    const wsRoot = getWorkspaceRootUri();
    if (!wsRoot) return [];
    // Ensure this pattern correctly finds your agent files
    return vscode.workspace.findFiles(new vscode.RelativePattern(wsRoot, '{agents/**/*.y*ml,.jules/agents/**/*.y*ml}'));
}

// --- Helper function to load agent schema (simplified for brevity, assume it exists from previous step) ---
function getAgentSchema(workspaceRootPath: string): Schema | null {
    const schemaPathRoot = nodePath.join(workspaceRootPath, 'agent-definition.schema.json');
    if (fs.existsSync(schemaPathRoot)) {
        try { return JSON.parse(fs.readFileSync(schemaPathRoot, 'utf8')) as Schema; } catch (e) { 
            aiOutputChannel?.appendLine(`Error parsing schema at ${schemaPathRoot}: ${e}`);
            return null; 
        }
    }
    const schemaPathDotSchemas = nodePath.join(workspaceRootPath, '.schemas', 'agent-definition.schema.json');
    if (fs.existsSync(schemaPathDotSchemas)) {
        try { return JSON.parse(fs.readFileSync(schemaPathDotSchemas, 'utf8')) as Schema; } catch (e) { 
            aiOutputChannel?.appendLine(`Error parsing schema at ${schemaPathDotSchemas}: ${e}`);
            return null; 
        }
    }
    aiOutputChannel?.appendLine(`Schema file not found at ${schemaPathRoot} or ${schemaPathDotSchemas}`);
    return null;
}

// --- Helper functions for Python tool name conversion (simplified for brevity, assume it exists from previous step) ---
function toSnakeCase(str: string): string { return str.replace(/\s+/g, '_').toLowerCase(); }
function toPascalCase(str: string): string { return str.replace(/(?:^|\s)\w/g, m => m.toUpperCase()).replace(/\s+/g, ''); }
function getPythonToolBoilerplate(className: string): string { return `class ${className}:\n    pass\n`; }


export function activate(context: vscode.ExtensionContext) {
    if (!aiOutputChannel) {
        aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem");
        context.subscriptions.push(aiOutputChannel);
    }
    aiOutputChannel.appendLine('AI Ecosystem Core extension activated.');

    // --- Register other existing commands (simplified stubs for brevity) ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => { 
        vscode.window.showInformationMessage('Hello World from AI Ecosystem Core!');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => { 
        const agentFiles = await findAgentDefinitionFiles();
        if (agentFiles.length === 0) { vscode.window.showInformationMessage('No agent definitions found.'); return; }
        const workspaceRootPath = getWorkspaceRootPath();
        const fileItems = agentFiles.map(uri => ({ 
            label: workspaceRootPath ? nodePath.relative(workspaceRootPath, uri.fsPath) : uri.fsPath, 
            description: uri.fsPath,
            uri: uri 
        }));
        const selected = await vscode.window.showQuickPick(fileItems, { placeHolder: 'Select agent file to open', matchOnDescription: true });
        if (selected) { 
            try {
                await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri)); 
            } catch (e) {
                vscode.window.showErrorMessage(`Error opening file: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.validateAgentDefinitions', async () => { 
        const workspaceRootPath = getWorkspaceRootPath();
        if (!workspaceRootPath) { vscode.window.showErrorMessage('No workspace open.'); return; }
        
        if (!aiOutputChannel) { 
            aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem");
            context.subscriptions.push(aiOutputChannel);
        }

        const schema = getAgentSchema(workspaceRootPath);
        if (!schema) {
             vscode.window.showErrorMessage('Agent schema could not be loaded. Validation aborted.');
            return;
        }
        const ajv = new Ajv({ allErrors: true });
        let validate;
        try { validate = ajv.compile(schema); } 
        catch (e) { 
            const errorMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Schema compilation error: ${errorMsg}`); 
            aiOutputChannel?.appendLine(`Schema compilation error: ${errorMsg}`);
            return; 
        }
        const agentFiles = await findAgentDefinitionFiles();
        if (agentFiles.length === 0) { vscode.window.showInformationMessage('No agent files to validate.'); return; }
        
        aiOutputChannel.clear(); aiOutputChannel.show(true);
        aiOutputChannel.appendLine(`Validating ${agentFiles.length} agent files...`);
        for (const fileUri of agentFiles) {
            const relativePath = nodePath.relative(workspaceRootPath, fileUri.fsPath);
            aiOutputChannel.appendLine(`\nValidating ${relativePath}:`);
            try {
                const content = await vscode.workspace.fs.readFile(fileUri);
                const data = yaml.load(Buffer.from(content).toString('utf8'));
                 if (typeof data !== 'object' || data === null) {
                    aiOutputChannel.appendLine("  Status: INVALID - YAML content is not a valid object or is null.");
                    continue;
                }
                const isValid = validate(data);
                aiOutputChannel.appendLine(`  Status: ${isValid ? 'VALID' : 'INVALID'}`);
                if (!isValid && validate.errors) { 
                    validate.errors.forEach(err => aiOutputChannel?.appendLine(`    Error: ${err.message} (Path: ${err.instancePath || 'N/A'})`)); 
                }
            } catch (e) {
                 aiOutputChannel.appendLine(`  Status: ERROR - Could not process file. ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        vscode.window.showInformationMessage('Validation complete. See "AI Ecosystem" output.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => { 
        const workspaceRootPath = getWorkspaceRootPath();
        if (!workspaceRootPath) { vscode.window.showErrorMessage('No workspace open.'); return; }
        const agentNameInput = await vscode.window.showInputBox({ prompt: "Agent name", validateInput: text => (!text || text.trim().length === 0) ? "Cannot be empty." : null });
        if (!agentNameInput) return;
        const agentName = agentNameInput.trim();
        const targetDir = nodePath.join(workspaceRootPath, '.jules', 'agents');
        const targetDirUri = vscode.Uri.file(targetDir);
        try { await vscode.workspace.fs.stat(targetDirUri); } 
        catch { try { await vscode.workspace.fs.createDirectory(targetDirUri); } catch (e) { vscode.window.showErrorMessage(`Failed to create dir: ${e instanceof Error ? e.message : String(e)}`); return; } }
        const baseFilename = agentName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '');
        const filePath = nodePath.join(targetDir, `${baseFilename}.agent.yaml`);
        const fileUri = vscode.Uri.file(filePath);
        try { await vscode.workspace.fs.stat(fileUri); const ow = await vscode.window.showWarningMessage(`File exists. Overwrite?`,{ modal: true },"Overwrite"); if (ow !== "Overwrite") return; } 
        catch { /* Proceed */ }
        const placeholderContent = { name: agentName, description: `Desc for ${agentName}.`, core_prompt: `Prompt for ${agentName}.` };
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(yaml.dump(placeholderContent), 'utf8'));
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
        vscode.window.showInformationMessage(`Agent '${nodePath.basename(filePath)}' created.`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => { 
        const workspaceRootPath = getWorkspaceRootPath();
        if (!workspaceRootPath) { vscode.window.showErrorMessage("No workspace open."); return; }
        const toolNameInput = await vscode.window.showInputBox({ prompt: "Python tool name (e.g., 'My Data Processor')", validateInput: text => (!text || text.trim().length === 0) ? "Tool name cannot be empty." : (!/^[a-zA-Z0-9\s_.-]+$/.test(text)) ? "Invalid characters." : null });
        if (!toolNameInput) return;
        const conceptualToolName = toolNameInput.trim();
        const defaultRelativePath = 'libraries/python/tools';
        const targetRelativeDirInput = await vscode.window.showInputBox({ prompt: "Target directory for Python tool", value: defaultRelativePath, validateInput: text => (!text || text.trim().length === 0) ? "Target directory cannot be empty." : (nodePath.isAbsolute(text)) ? "Use relative path." : null });
        if (!targetRelativeDirInput) return;
        const targetRelativeDir = targetRelativeDirInput.trim();
        const className = toPascalCase(conceptualToolName);
        const baseFilename = toSnakeCase(conceptualToolName);
        const pythonFileName = `${baseFilename}.py`;
        const fullDirPath = nodePath.join(workspaceRootPath, targetRelativeDir);
        const fullDirUri = vscode.Uri.file(fullDirPath);
        const fullFilePath = nodePath.join(fullDirPath, pythonFileName);
        const fullFileUri = vscode.Uri.file(fullFilePath);
        try { await vscode.workspace.fs.stat(fullDirUri); } 
        catch { try { await vscode.workspace.fs.createDirectory(fullDirUri); } catch (e) { vscode.window.showErrorMessage(`Failed to create dir: ${e instanceof Error ? e.message : String(e)}`); return; } }
        try { await vscode.workspace.fs.stat(fullFileUri); const ow = await vscode.window.showWarningMessage(`File '${pythonFileName}' already exists. Overwrite?`, { modal: true }, "Overwrite"); if (ow !== "Overwrite") { return; } } 
        catch { /* File does not exist, proceed */ }
        const boilerplateContent = getPythonToolBoilerplate(className);
        await vscode.workspace.fs.writeFile(fullFileUri, Buffer.from(boilerplateContent, 'utf8'));
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fullFileUri));
        vscode.window.showInformationMessage(`Python tool '${pythonFileName}' created in '${targetRelativeDir}'.`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => { /* ... (Prompt Engineer UI logic from previous step) ... */ 
        if (promptEngineerPanel) { promptEngineerPanel.reveal(); return; }
        promptEngineerPanel = vscode.window.createWebviewPanel('promptEngineerUI', 'Prompt Engineering UI', vscode.ViewColumn.One, 
            { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')] });
        promptEngineerPanel.webview.html = getWebviewHtml(promptEngineerPanel.webview, context.extensionUri, 'prompt-engineer-ui.html', 'main.js'); // Assuming main.js for prompt UI
        promptEngineerPanel.webview.onDidReceiveMessage(message => {
            if (message.command === 'sendPrompt') {
                aiOutputChannel?.appendLine(`Prompt UI: ${message.promptName}, Context: ${message.context}`);
                promptEngineerPanel?.webview.postMessage({ command: 'llmResponse', response: `Mocked response to ${message.promptName}` });
            }
        });
        promptEngineerPanel.onDidDispose(() => { promptEngineerPanel = undefined; }, null, context.subscriptions);
    }));


    // --- Register ai-ecosystem-core.openSimulator command ---
    context.subscriptions.push(vscode.commands.registerCommand('ai-ecosystem-core.openSimulator', () => {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (simulatorPanel) {
            simulatorPanel.reveal(columnToShowIn);
            return;
        }

        simulatorPanel = vscode.window.createWebviewPanel(
            'agentSimulator', // Identifies the type of the webview.
            '🧪 Agent Simulator', // Title of the panel.
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'webview'), // General webview resources
                    vscode.Uri.joinPath(context.extensionUri, 'webview', 'simulator') // Simulator specific
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
                                id: uri.fsPath, 
                                name: nodePath.basename(uri.fsPath) + (workspaceRootPath ? ` (${nodePath.relative(workspaceRootPath, uri.fsPath)})` : '')
                            }));
                            simulatorPanel?.webview.postMessage({ command: 'populateAgentSelector', agents: agentList });
                        } catch (e) {
                            const errorMsg = e instanceof Error ? e.message : String(e);
                            vscode.window.showErrorMessage('Error finding agent definitions for simulator: ' + errorMsg);
                            aiOutputChannel?.appendLine('Error finding agent definitions for simulator: ' + errorMsg);
                            simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Error: Could not load agent list.' });
                        }
                        return;
                    case 'runSimulation':
                        aiOutputChannel?.appendLine(`Simulator: Run requested for agent: ${message.agentId} with input: "${message.initialInput}"`);
                        simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: `Simulation started for agent: ${message.agentId}` });
                        simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: `Initial input: "${message.initialInput}"` });
                        simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'running' }); 
                        
                        // Simulate some processing
                        setTimeout(() => {
                            simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Agent processing step 1...' });
                        }, 500);
                        setTimeout(() => {
                            simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Agent processing step 2... encountering condition...' });
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'paused' }); 
                        }, 1500);
                        return;
                    case 'controlSimulation':
                        aiOutputChannel?.appendLine(`Simulator: Control action: ${message.action}`);
                        simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: `Control action: ${message.action} received.` });
                        
                        if (message.action === 'stop') {
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'stopped' });
                        } else if (message.action === 'pause') {
                             simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'paused' });
                        } else if (message.action === 'resume') {
                             simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Resuming simulation... Agent continues processing...' });
                             simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'running' }); 
                             setTimeout(() => {
                                simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Agent processing step 3 after resume...' });
                                simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'completed' }); // Or 'stopped'
                            }, 1000);
                        } else if (message.action === 'step') {
                            simulatorPanel?.webview.postMessage({ command: 'simulationLogEntry', data: 'Stepping through next action... (mocked)' });
                            // Stays paused after a step for this mock
                            simulatorPanel?.webview.postMessage({ command: 'simulationStateUpdate', state: 'paused' }); 
                        }
                        return;
                    case 'showErrorUser': // Renamed from 'showError' to distinguish from internal errors
                        vscode.window.showErrorMessage(message.text);
                        aiOutputChannel?.appendLine(`Error from Simulator UI: ${message.text}`);
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        simulatorPanel.onDidDispose(
            () => {
                simulatorPanel = undefined;
            },
            null,
            context.subscriptions
        );
    }));
}

export function deactivate() {
    if (aiOutputChannel) {
        aiOutputChannel.dispose();
    }
    if (promptEngineerPanel) {
        promptEngineerPanel.dispose();
    }
    if (simulatorPanel) {
        simulatorPanel.dispose();
    }
}

```
