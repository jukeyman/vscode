import { IContextItem } from './IContextItem';

export interface GraphNode {
    id: string; // Unique ID for the node (e.g., file path, class name, function signature)
    type: string; // e.g., "file", "class", "function", "module", "variable"
    label: string; // User-friendly label for display
    itemRef?: string; // Optional reference to an IContextItem's ID
    metadata?: any; // e.g., file path for non-file nodes, start/end lines
}

export interface GraphEdge {
    id: string; // Unique ID for the edge (e.g., sourceId_targetId_type)
    source: string; // ID of the source GraphNode
    target: string; // ID of the target GraphNode
    type: string; // e.g., "imports", "calls", "inherits_from", "contains_definition"
    metadata?: any; // e.g., specific import alias, call site line number
}

export class CodebaseGraph {
    private nodes: Map<string, GraphNode> = new Map();
    private edges: Map<string, GraphEdge> = new Map();

    constructor() {
        console.log("CodebaseGraph: Initialized.");
    }

    /**
     * Adds a node to the graph.
     * @param node The GraphNode to add.
     */
    async addNode(node: GraphNode): Promise<void> {
        if (!node || !node.id) {
            console.error("CodebaseGraph: Node and Node ID are required to add a node.");
            return;
        }
        if (this.nodes.has(node.id)) {
            // console.warn(`CodebaseGraph: Node with ID '${node.id}' already exists. Updating (conceptual).`);
            // Optionally update existing node properties if needed
            // this.nodes.set(node.id, { ...this.nodes.get(node.id), ...node });
        } else {
            this.nodes.set(node.id, node);
        }
        // console.log(`CodebaseGraph: Added/Updated node: ${node.id} - ${node.type}`);
    }

    /**
     * Adds an edge to the graph.
     * @param edge The GraphEdge to add.
     */
    async addEdge(edge: GraphEdge): Promise<void> {
        if (!edge || !edge.id || !edge.source || !edge.target) {
            console.error("CodebaseGraph: Edge ID, source, and target are required to add an edge.");
            return;
        }
        if (!this.nodes.has(edge.source)) {
            console.warn(`CodebaseGraph: Source node '${edge.source}' for edge '${edge.id}' not found. Edge not added.`);
            return;
        }
        if (!this.nodes.has(edge.target)) {
            console.warn(`CodebaseGraph: Target node '${edge.target}' for edge '${edge.id}' not found. Edge not added.`);
            return;
        }

        this.edges.set(edge.id, edge);
        // console.log(`CodebaseGraph: Added edge: ${edge.source} -> ${edge.target} (${edge.type}) with ID ${edge.id}`);
    }

    /**
     * Retrieves a node by its ID.
     * @param id The ID of the node to retrieve.
     * @returns The GraphNode if found, otherwise undefined.
     */
    getNode(id: string): GraphNode | undefined {
        return this.nodes.get(id);
    }

    /**
     * Retrieves an edge by its ID.
     * @param id The ID of the edge to retrieve.
     * @returns The GraphEdge if found, otherwise undefined.
     */
    getEdge(id: string): GraphEdge | undefined {
        return this.edges.get(id);
    }

    /**
     * Finds nodes related to a given node ID.
     * Mocked/Simple implementation for now.
     * @param nodeId The ID of the source node.
     * @param relationType Optional filter by relation type.
     * @param depth The depth of relationships to explore (currently only supports 1).
     * @returns A promise that resolves to an array of related GraphNodes.
     */
    async findRelatedNodes(nodeId: string, relationType?: string, depth: number = 1): Promise<GraphNode[]> {
        console.log(`CodebaseGraph: Finding related nodes for '${nodeId}', type: ${relationType || 'any'}, depth: ${depth}.`);
        const relatedNodes: GraphNode[] = [];
        const visitedNodeIds: Set<string> = new Set();

        if (!this.nodes.has(nodeId)) {
            console.warn(`CodebaseGraph: Node '${nodeId}' not found for finding relations.`);
            return [];
        }
        
        if (depth !== 1) {
            console.warn("CodebaseGraph: findRelatedNodes currently only supports depth 1.");
            // Basic implementation for depth 1
        }

        for (const edge of this.edges.values()) {
            if (relationType && edge.type !== relationType) {
                continue;
            }

            if (edge.source === nodeId && this.nodes.has(edge.target) && !visitedNodeIds.has(edge.target)) {
                relatedNodes.push(this.nodes.get(edge.target)!);
                visitedNodeIds.add(edge.target);
            } else if (edge.target === nodeId && this.nodes.has(edge.source) && !visitedNodeIds.has(edge.source)) {
                relatedNodes.push(this.nodes.get(edge.source)!);
                visitedNodeIds.add(edge.source);
            }
        }
        console.log(`CodebaseGraph: Found ${relatedNodes.length} related nodes for '${nodeId}'.`);
        return relatedNodes;
    }

    /**
     * Builds a graph from an array of file context items.
     * Highly conceptual for this step. Actual AST parsing is complex.
     * @param files An array of IContextItem representing files.
     */
    async buildGraphFromFiles(files: IContextItem[]): Promise<void> {
        console.log(`CodebaseGraph: buildGraphFromFiles called with ${files.length} files (conceptual parsing).`);

        for (const fileItem of files) {
            if (fileItem.type !== 'file' || !fileItem.metadata?.filePath) {
                continue;
            }

            // Add node for the file itself
            const fileNodeId = fileItem.metadata.filePath; // Use file path as unique ID for file node
            await this.addNode({
                id: fileNodeId,
                type: 'file',
                label: fileItem.metadata.filePath.split(path.sep).pop() || fileNodeId,
                itemRef: fileItem.id,
                metadata: { filePath: fileItem.metadata.filePath, languageId: fileItem.metadata.languageId }
            });

            // Mocked parsing for classes and imports
            const classRegex = /class\s+([A-Za-z_]\w*)/g;
            let match;
            while ((match = classRegex.exec(fileItem.content)) !== null) {
                const className = match[1];
                const classNodeId = `${fileNodeId}#${className}`; // Composite ID for class within file
                await this.addNode({
                    id: classNodeId,
                    type: 'class',
                    label: className,
                    itemRef: fileItem.id, // Could point to a more specific item if we had line numbers
                    metadata: { filePath: fileItem.metadata.filePath, className: className }
                });
                await this.addEdge({
                    id: `${fileNodeId}_contains_${classNodeId}`,
                    source: fileNodeId,
                    target: classNodeId,
                    type: 'contains_definition',
                    metadata: { definitionType: 'class' }
                });
            }

            const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
            while ((match = importRegex.exec(fileItem.content)) !== null) {
                const importPath = match[1];
                // For simplicity, treat importPath as a node ID. 
                // In reality, resolve this path to an actual file node ID.
                const importedFileNodeId = importPath; // This is a simplification
                
                // Add a placeholder node for the imported module/file if it doesn't exist
                // In a real system, this would be resolved to an existing file node or an external module node
                if (!this.nodes.has(importedFileNodeId)) {
                     await this.addNode({
                        id: importedFileNodeId,
                        type: 'external_module_or_unresolved_file', // Indicate it's not fully resolved
                        label: importedFileNodeId,
                        metadata: { path: importPath }
                    });
                }
               
                await this.addEdge({
                    id: `${fileNodeId}_imports_${importedFileNodeId}`,
                    source: fileNodeId,
                    target: importedFileNodeId,
                    type: 'imports'
                });
            }
        }
        console.log(`CodebaseGraph: Conceptual graph building complete. Nodes: ${this.nodes.size}, Edges: ${this.edges.size}`);
    }

    /**
     * Returns a simplified representation of the graph.
     * @param depth Max depth for representation (not implemented, returns full graph for now)
     */
    getGraphRepresentation(depth: number = 2): any {
        // For now, return all nodes and edges. Depth parameter is for future expansion.
        return {
            nodes: Array.from(this.nodes.values()),
            edges: Array.from(this.edges.values())
        };
    }

    /**
     * Clears all nodes and edges from the graph.
     */
    clearGraph(): void {
        this.nodes.clear();
        this.edges.clear();
        console.log("CodebaseGraph: Graph cleared.");
    }
}
```
