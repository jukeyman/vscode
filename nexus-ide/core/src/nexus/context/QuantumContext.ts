import { IContextItem } from './IContextItem';
import { SemanticIndex } from './SemanticIndex';
import { CodebaseGraph } from './CodebaseGraph';
import * as vscode from 'vscode'; // For active editor, workspace - conceptual for core logic
import * as fs from 'fs/promises'; // For file reading - conceptual for core logic
import * as path from 'path'; // For path operations - conceptual for core logic

export class QuantumContext {
    private semanticIndex: SemanticIndex;
    private codebaseGraph: CodebaseGraph;
    private activeContextItems: IContextItem[] = [];

    constructor() {
        this.semanticIndex = new SemanticIndex();
        this.codebaseGraph = new CodebaseGraph();
        console.log("QuantumContext: Initialized with new SemanticIndex and CodebaseGraph.");
    }

    /**
     * Gets the content of the currently active text editor.
     * This is conceptual as direct VS Code API access is typically in the extension part.
     * In a real scenario, this method might be called by the extension,
     * which then passes the content to the core QuantumContext.
     */
    async getActiveEditorContext(): Promise<IContextItem | null> {
        console.log("QuantumContext: Attempting to get active editor context (conceptual).");
        // This part requires VS Code API and would typically reside in the extension code
        // that interacts with this core logic.
        if (typeof vscode !== 'undefined' && vscode.window && vscode.window.activeTextEditor) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const item: IContextItem = {
                    id: document.uri.toString(),
                    type: 'file',
                    content: document.getText(),
                    metadata: {
                        filePath: document.uri.fsPath,
                        languageId: document.languageId,
                        lineCount: document.lineCount,
                    },
                };
                console.log(`QuantumContext: Active editor context retrieved for ${item.metadata.filePath}`);
                return item;
            }
        }
        console.log("QuantumContext: No active editor found or vscode API not available in this context.");
        return null;
    }

    /**
     * Retrieves context from project files based on specified glob patterns.
     * This is conceptual for core logic; file system access would be managed by the extension.
     */
    async getProjectContext(options?: { fileGlobs?: string[], parseDependencies?: boolean }): Promise<IContextItem[]> {
        console.log("QuantumContext: Getting project context (conceptual). Options:", options);
        const defaultGlobs = ['**/*.{ts,js,py,md,json,yaml,yml}']; // More comprehensive default
        const globsToUse = options?.fileGlobs || defaultGlobs;
        const projectItems: IContextItem[] = [];

        if (typeof vscode !== 'undefined' && vscode.workspace && vscode.workspace.findFiles) {
            for (const glob of globsToUse) {
                try {
                    const files = await vscode.workspace.findFiles(glob, '**/node_modules/**'); // Exclude node_modules
                    for (const fileUri of files) {
                        try {
                            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
                            const content = Buffer.from(contentBytes).toString('utf8');
                            const item: IContextItem = {
                                id: fileUri.toString(),
                                type: 'file',
                                content: content,
                                metadata: {
                                    filePath: fileUri.fsPath,
                                    size: content.length,
                                },
                            };
                            projectItems.push(item);
                        } catch (readError) {
                            console.error(`QuantumContext: Error reading file ${fileUri.fsPath}:`, readError);
                        }
                    }
                } catch (findError) {
                     console.error(`QuantumContext: Error finding files with glob ${glob}:`, findError);
                }
            }

            if (options?.parseDependencies) {
                console.log("QuantumContext: Dependency parsing requested (conceptual).");
                // This would involve calling this.codebaseGraph.buildGraphFromFiles(projectItems)
                // For now, we just acknowledge it.
                await this.codebaseGraph.buildGraphFromFiles(projectItems); // Conceptual call
            }
        } else {
            console.log("QuantumContext: vscode.workspace.findFiles API not available. Cannot get project context.");
        }
        
        console.log(`QuantumContext: Retrieved ${projectItems.length} project items.`);
        return projectItems;
    }

    /**
     * Performs a semantic search using the SemanticIndex.
     */
    async getSemanticSearchResults(query: string, limit: number = 5): Promise<IContextItem[]> {
        console.log(`QuantumContext: Performing semantic search for query: "${query}" with limit ${limit}.`);
        return this.semanticIndex.search(query, limit);
    }

    /**
     * Adds a context item to the active context and indexes it.
     */
    async addContextItem(item: IContextItem): Promise<void> {
        // Avoid duplicates in activeContextItems based on ID
        if (!this.activeContextItems.find(existing => existing.id === item.id)) {
            this.activeContextItems.push(item);
            console.log(`QuantumContext: Added item '${item.id}' to active context.`);
        } else {
            console.log(`QuantumContext: Item '${item.id}' already in active context. Updating content/metadata if necessary (conceptual).`);
            // Optionally, update existing item if content/metadata changed
            const index = this.activeContextItems.findIndex(existing => existing.id === item.id);
            this.activeContextItems[index] = item;
        }
        await this.semanticIndex.indexItem(item); // Index it (idempotent in current mock)
    }
    
    /**
     * Adds multiple context items.
     */
    async addContextItems(items: IContextItem[]): Promise<void> {
        for (const item of items) {
            // Using the same logic as addContextItem to avoid duplicates in activeContextItems
            if (!this.activeContextItems.find(existing => existing.id === item.id)) {
                this.activeContextItems.push(item);
            } else {
                 const index = this.activeContextItems.findIndex(existing => existing.id === item.id);
                 this.activeContextItems[index] = item; // Update if already exists
            }
        }
        await this.semanticIndex.indexItems(items); // Index all items
        console.log(`QuantumContext: Added ${items.length} items to active context and semantic index.`);
    }


    /**
     * Returns a snapshot of the currently active context items.
     */
    getActiveContextSnapshot(): IContextItem[] {
        console.log(`QuantumContext: Retrieving active context snapshot (${this.activeContextItems.length} items).`);
        return [...this.activeContextItems]; // Return a copy
    }

    /**
     * Clears all items from the active context.
     * Note: This does not clear the SemanticIndex or CodebaseGraph.
     * Separate methods would be needed for that if desired.
     */
    clearActiveContext(): void {
        this.activeContextItems = [];
        console.log("QuantumContext: Active context cleared.");
    }

    /**
     * Returns a simplified representation of the codebase graph.
     * Conceptual for now.
     */
    async getCodebaseGraphStructure(depth: number = 2): Promise<any> {
        console.log(`QuantumContext: Getting codebase graph structure (depth ${depth}) (conceptual).`);
        // In a real implementation, this would query the CodebaseGraph instance.
        // For now, return a mock structure or whatever CodebaseGraph.getGraphRepresentation() provides.
        return this.codebaseGraph.getGraphRepresentation(depth); 
    }

    // --- Methods for interacting with CodebaseGraph and SemanticIndex directly if needed ---
    
    /**
     * Directly accesses the CodebaseGraph instance.
     */
    public get graph(): CodebaseGraph {
        return this.codebaseGraph;
    }

    /**
     * Directly accesses the SemanticIndex instance.
     */
    public get index(): SemanticIndex {
        return this.semanticIndex;
    }
}
```
