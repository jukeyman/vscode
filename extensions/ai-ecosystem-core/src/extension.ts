import * as vscode from 'vscode';
import * as fs from 'fs'; 
import * as path from 'path';
import Ajv from 'ajv';
import * as yaml from 'js-yaml';

// Define a dedicated output channel (reuse if already defined)
let aiOutputChannel: vscode.OutputChannel;
let promptEngineerPanel: vscode.WebviewPanel | undefined = undefined;


// Helper function to get workspace root URI (reuse if already defined)
function getWorkspaceRootUri(): vscode.Uri | undefined {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri;
    }
    return undefined;
}

// --- Helper functions for Python tool name conversion (from previous step) ---
function toSnakeCase(str: string): string {
    return str
        .replace(/\s+/g, '_') 
        .replace(/([A-Z])/g, (match, p1, offset) => (offset > 0 ? '_' : '') + p1.toLowerCase()) 
        .replace(/__+/g, '_') 
        .toLowerCase();
}

function toPascalCase(str: string): string {
    return str
        .replace(/[\s_-]+/g, ' ') 
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

// --- Helper function to generate Python boilerplate (from previous step) ---
function getPythonToolBoilerplate(className: string): string {
    return `import typing

class ${className}:
    """
    A brief description of what this tool does.
    """
    def __init__(self, config: typing.Optional[dict] = None):
        """
        Initializes the ${className}.

        Args:
            config (typing.Optional[dict], optional): 
                A dictionary containing configuration parameters. 
                Defaults to None.
        """
        self.config = config or {}
        # Example: self.api_key = self.config.get("api_key")
        print(f"${className} initialized with config: {self.config}")

    def process_data(self, data: dict) -> dict:
        """
        Example method to process data.

        Args:
            data (dict): The input data dictionary.

        Returns:
            dict: The processed data dictionary.
        """
        print(f"Processing data in ${className}: {data}")
        # TODO: Implement actual data processing logic
        processed_data = data.copy() 
        processed_data["processed_by"] = "${className}"
        processed_data["timestamp"] = self._get_timestamp()
        return processed_data

    def _get_timestamp(self) -> str:
        """
        Private helper method to get a timestamp.
        """
        import datetime
        return datetime.datetime.now().isoformat()

    def another_method(self, input_string: str, count: int = 1) -> typing.List[str]:
        """
        Another example method.

        Args:
            input_string (str): A string to be processed.
            count (int, optional): Number of times to repeat. Defaults to 1.

        Returns:
            typing.List[str]: A list of strings.
        """
        print(f"Running another_method in ${className} with input: '{input_string}', count: {count}")
        # TODO: Implement logic
        return [f"{input_string}_{i}" for i in range(count)]

if __name__ == "__main__":
    tool_config = {"setting1": "value1", "api_key": "your_api_key_here_if_needed"}
    my_tool = ${className}(config=tool_config)
    sample_data = {"id": 123, "payload": "some content"}
    result = my_tool.process_data(sample_data)
    print(f"Process_data result: {result}")
    string_list = my_tool.another_method("test", count=3)
    print(f"Another_method result: {string_list}")
`;
}

// --- scanForAgentDefinitions function (from previous step) ---
async function scanForAgentDefinitions(): Promise<vscode.Uri[]> {
    const workspaceRoot = getWorkspaceRootUri();
    if (!workspaceRoot) {
        // vscode.window.showErrorMessage("No workspace open."); // Handled by callers
        return [];
    }
    const targetDirectories = ['/.jules/agents/', '/agents/'];
    let allAgentFiles: vscode.Uri[] = [];
    for (const dir of targetDirectories) {
        try {
            const searchPattern = new vscode.RelativePattern(workspaceRoot, path.join(workspaceRoot.fsPath, dir, '**/*.{yaml,yml}').substring(workspaceRoot.fsPath.length));
            const files = await vscode.workspace.findFiles(searchPattern);
            allAgentFiles = allAgentFiles.concat(files);
        } catch (error) {
            console.error(`Error scanning directory ${dir}:`, error);
        }
    }
    return Array.from(new Set(allAgentFiles.map(uri => uri.toString()))).map(s => vscode.Uri.parse(s));
}


// Helper function to get HTML for webview
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, htmlFileName: string): string {
    const htmlFilePath = vscode.Uri.joinPath(extensionUri, 'webview', htmlFileName);
    let htmlContent = "";
    try {
        htmlContent = fs.readFileSync(htmlFilePath.fsPath, 'utf8');
    } catch (err) {
        console.error("Error reading webview HTML file:", err);
        return `<html><body>Error loading webview content. Path: ${htmlFilePath.fsPath}</body></html>`;
    }
    

    // Replace placeholders for script and CSS URIs
    const scriptDiskPath = vscode.Uri.joinPath(extensionUri, 'webview', 'main.js');
    const scriptUri = webview.asWebviewUri(scriptDiskPath);
    
    // If you have a separate CSS file, uncomment and adjust:
    // const styleDiskPath = vscode.Uri.joinPath(extensionUri, 'webview', 'style.css');
    // const styleUri = webview.asWebviewUri(styleDiskPath);

    // Make sure to use a more robust replacement method if your HTML structure is complex
    // This simple replace might break if attributes change order or new attributes are added.
    htmlContent = htmlContent.replace(
        '<script src="main.js"></script>',
        `<script src="${scriptUri}"></script>`
    );
    // htmlContent = htmlContent.replace(
    //     '<link rel="stylesheet" href="style.css">',
    //     `<link rel="stylesheet" href="${styleUri}">`
    // );
    
    return htmlContent;
}


export function activate(context: vscode.ExtensionContext) {
    // Initialize output channel (if not already done in a shared way)
    if (!aiOutputChannel) {
        aiOutputChannel = vscode.window.createOutputChannel("AI Ecosystem"); // Changed name for consistency
        context.subscriptions.push(aiOutputChannel); 
    }
    aiOutputChannel.appendLine('AI Ecosystem Core extension activated.');


    // --- Hello World Command (existing) ---
    let helloWorldDisposable = vscode.commands.registerCommand('ai-ecosystem-core.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from AI Ecosystem Core!');
    });
    context.subscriptions.push(helloWorldDisposable);

    // --- ListAgents Command (existing) ---
    let listAgentsDisposable = vscode.commands.registerCommand('ai-ecosystem-core.listAgents', async () => {
        const agentFiles = await scanForAgentDefinitions();
        if (agentFiles.length === 0) {
            vscode.window.showInformationMessage('No AI agent definitions found in configured directories (e.g., /.jules/agents/, /agents/).');
            return;
        }
        const agentFileNames = agentFiles.map(uri => {
            const workspaceRoot = getWorkspaceRootUri();
            return workspaceRoot ? path.relative(workspaceRoot.fsPath, uri.fsPath) : uri.fsPath;
        });
        vscode.window.showQuickPick(agentFileNames, { placeHolder: 'Found AI Agent Definitions' });
    });
    context.subscriptions.push(listAgentsDisposable);
    
    // --- ValidateAgents Command (existing) ---
    let validateAgentsDisposable = vscode.commands.registerCommand('ai-ecosystem-core.validateAgents', async () => {
        const workspaceRoot = getWorkspaceRootUri();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("Cannot validate agents: No workspace open.");
            return;
        }
        const agentFiles = await scanForAgentDefinitions();
        if (agentFiles.length === 0) {
            vscode.window.showInformationMessage('No AI agent definitions found to validate.');
            return;
        }
        aiOutputChannel.clear();
        aiOutputChannel.show(true);
        aiOutputChannel.appendLine(`Starting validation for ${agentFiles.length} agent definition(s)...\n`);
        let schema;
        const schemaPath = vscode.Uri.joinPath(workspaceRoot, 'agent-definition.schema.json'); 
        try {
            const schemaContent = await vscode.workspace.fs.readFile(schemaPath);
            schema = JSON.parse(Buffer.from(schemaContent).toString('utf8'));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load agent definition schema from ${schemaPath.fsPath}. Ensure it exists at the workspace root.`);
            aiOutputChannel.appendLine(`ERROR: Failed to load agent definition schema: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const ajv = new Ajv({ allErrors: true });
        let validateFunction;
        try {
            validateFunction = ajv.compile(schema);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to compile the agent definition schema. Check schema correctness. Details in "AI Ecosystem" output.`);
            aiOutputChannel.appendLine(`ERROR: Schema compilation failed: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && (error as any).errors) {
                 aiOutputChannel.appendLine('Schema errors:');
                 (error as any).errors.forEach((err: any) => { 
                     aiOutputChannel.appendLine(`  - ${err.instancePath || 'schema'}: ${err.message}`);
                 });
            }
            return;
        }
        let successCount = 0;
        let failureCount = 0;
        for (const fileUri of agentFiles) {
            const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath);
            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const agentData = yaml.load(Buffer.from(fileContent).toString('utf8'));
                if (validateFunction(agentData)) {
                    aiOutputChannel.appendLine(`SUCCESS: ${relativePath} is valid.`);
                    successCount++;
                } else {
                    failureCount++;
                    aiOutputChannel.appendLine(`FAILURE: ${relativePath} is invalid.`);
                    if (validateFunction.errors) {
                        validateFunction.errors.forEach(err => {
                            aiOutputChannel.appendLine(`  - Path: ${err.instancePath || '/'}\n    Message: ${err.message}\n    Details: ${JSON.stringify(err.params)}`);
                        });
                    }
                    aiOutputChannel.appendLine('');
                }
            } catch (error) {
                failureCount++;
                aiOutputChannel.appendLine(`ERROR processing ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const summaryMessage = `Validation complete. Total: ${agentFiles.length}, Successful: ${successCount}, Failed: ${failureCount}.`;
        vscode.window.showInformationMessage(summaryMessage + (failureCount > 0 ? ' Check "AI Ecosystem" output for details.' : ''));
        aiOutputChannel.appendLine(`\n${summaryMessage}`);
    });
    context.subscriptions.push(validateAgentsDisposable);

    // --- CreateAgentDefinition Command (existing) ---
    let createAgentDisposable = vscode.commands.registerCommand('ai-ecosystem-core.createAgentDefinition', async () => {
        const workspaceRoot = getWorkspaceRootUri();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("Cannot create agent definition: No workspace open.");
            return;
        }
        const agentName = await vscode.window.showInputBox({
            prompt: "Enter a name for the new AI agent definition",
            validateInput: text => (!text || text.trim().length === 0) ? "Agent name cannot be empty." : (!/^[a-zA-Z0-9_.-]+$/.test(text)) ? "Invalid characters." : null
        });
        if (!agentName) { return; }
        const targetDirName = '/.jules/agents/'; 
        const targetDirUri = vscode.Uri.joinPath(workspaceRoot, targetDirName);
        try {
            await vscode.workspace.fs.stat(targetDirUri);
        } catch (error) {
            const createDirChoice = await vscode.window.showWarningMessage(`Directory '${targetDirName.slice(1)}' does not exist. Create it?`, { modal: true }, "Create Directory");
            if (createDirChoice === "Create Directory") {
                try { await vscode.workspace.fs.createDirectory(targetDirUri); } 
                catch (e) { 
                    const message = e instanceof Error ? e.message : String(e);
                    vscode.window.showErrorMessage(`Failed to create directory: ${message}`); 
                    return; 
                }
            } else { return; }
        }
        const fileName = `${agentName.trim().replace(/\s+/g, '_')}.agent.yaml`;
        const newFileUri = vscode.Uri.joinPath(targetDirUri, fileName);
        const placeholderContent = { 
            name: agentName.trim(),
            description: "A detailed description of this new agent.",
            core_prompt: `As ${agentName.trim()}, your primary directive is to...\n\nGuiding Principles:\n- Principle 1\n- Principle 2`,
            capabilities: ["capability1"], 
            version: "0.1.0-" + agentName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''), 
            tags: ["new-agent"]
        };
        try {
            await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(yaml.dump(placeholderContent), 'utf8'));
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(newFileUri));
            vscode.window.showInformationMessage(`Agent definition '${fileName}' created.`);
        } catch (error) { 
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create agent file: ${message}`); 
        }
    });
    context.subscriptions.push(createAgentDisposable);

    // --- AddAgentToolPython Command (existing) ---
    let addAgentToolPythonDisposable = vscode.commands.registerCommand('ai-ecosystem-core.addAgentToolPython', async () => {
        const workspaceRoot = getWorkspaceRootUri();
        if (!workspaceRoot) { vscode.window.showErrorMessage("Cannot create Python tool: No workspace open."); return; }
        const toolNameInput = await vscode.window.showInputBox({
            prompt: "Enter a name for the new Python agent tool (e.g., 'My Data Processor')",
            validateInput: text => (!text || text.trim().length === 0) ? "Tool name cannot be empty." : (!/^[a-zA-Z0-9\s_.-]+$/.test(text)) ? "Invalid characters." : null
        });
        if (!toolNameInput) { vscode.window.showInformationMessage("Python tool creation cancelled."); return; }
        const toolName = toolNameInput.trim();
        const className = toPascalCase(toolName);
        const fileName = `${toSnakeCase(toolName)}.py`;
        const defaultRelativePath = 'libraries/python/tools/';
        const targetRelativeDir = await vscode.window.showInputBox({ prompt: "Target directory for Python tool", value: defaultRelativePath, validateInput: text => (!text || text.trim().length === 0) ? "Target directory cannot be empty." : (path.isAbsolute(text)) ? "Use relative path." : null });
        if (!targetRelativeDir) { vscode.window.showInformationMessage("Python tool creation cancelled."); return; }
        const finalTargetDirUri = vscode.Uri.joinPath(workspaceRoot, targetRelativeDir.trim());
        const newFileUri = vscode.Uri.joinPath(finalTargetDirUri, fileName);
        try { await vscode.workspace.fs.stat(finalTargetDirUri); } 
        catch (error) {
            try { await vscode.workspace.fs.createDirectory(finalTargetDirUri); vscode.window.showInformationMessage(`Directory '${targetRelativeDir.trim()}' created.`); } 
            catch (createError) { const m = createError instanceof Error ? createError.message : String(createError); vscode.window.showErrorMessage(`Failed to create directory: ${m}`); return; }
        }
        try { await vscode.workspace.fs.stat(newFileUri); const ow = await vscode.window.showWarningMessage(`File '${fileName}' already exists. Overwrite?`, { modal: true }, "Overwrite"); if (ow !== "Overwrite") { vscode.window.showInformationMessage("Python tool creation cancelled."); return; } } 
        catch (error) { /* File does not exist, proceed */ }
        const boilerplateContent = getPythonToolBoilerplate(className);
        try {
            await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(boilerplateContent, 'utf8'));
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(newFileUri));
            vscode.window.showInformationMessage(`Python tool '${fileName}' created at '${targetRelativeDir.trim()}'.`);
        } catch (error) { const m = error instanceof Error ? error.message : String(error); vscode.window.showErrorMessage(`Failed to create Python tool file: ${m}`); }
    });
    context.subscriptions.push(addAgentToolPythonDisposable);


    // --- NEW: ai-ecosystem-core.openPromptEngineerUI command ---
    let openPromptEngineerUIDisposable = vscode.commands.registerCommand('ai-ecosystem-core.openPromptEngineerUI', () => {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (promptEngineerPanel) {
            promptEngineerPanel.reveal(column);
            return;
        }

        promptEngineerPanel = vscode.window.createWebviewPanel(
            'promptEngineerUI', 
            'Prompt Engineering UI', 
            column || vscode.ViewColumn.One, 
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')]
            }
        );

        promptEngineerPanel.webview.html = getWebviewContent(promptEngineerPanel.webview, context.extensionUri, 'prompt-engineer-ui.html');
        
        promptEngineerPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'sendPrompt':
                        aiOutputChannel.appendLine(`Prompt Engineer UI: Received 'sendPrompt'. Name: ${message.promptName}, Context: ${message.context}`);
                        vscode.window.showInformationMessage(`Received prompt: ${message.promptName}. Check "AI Ecosystem" output channel for details.`);
                        
                        const mockResponse = `This is a mocked LLM response for prompt: '${message.promptName}'.\nContext received: '${message.context}'.\nTimestamp: ${new Date().toLocaleTimeString()}`;
                        
                        promptEngineerPanel?.webview.postMessage({ command: 'llmResponse', response: mockResponse });
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
    });
    context.subscriptions.push(openPromptEngineerUIDisposable);
}

export function deactivate() {
    if (aiOutputChannel) {
        aiOutputChannel.dispose();
    }
    if (promptEngineerPanel) {
        promptEngineerPanel.dispose();
    }
}
```
