import { IContextItem } from './IContextItem';

export class SemanticIndex {
    private indexedItems: Map<string, IContextItem> = new Map();
    private mockEmbeddingsEnabled: boolean = true;

    constructor() {
        console.log("SemanticIndex: Initialized.");
    }

    /**
     * Indexes a single context item.
     * If mockEmbeddingsEnabled is true and no embedding exists, a mock embedding is generated.
     * @param item The context item to index.
     */
    async indexItem(item: IContextItem): Promise<void> {
        if (!item.id) {
            console.error("SemanticIndex: Item ID is required for indexing.", item);
            return;
        }

        const existingItem = this.indexedItems.get(item.id);

        if (this.mockEmbeddingsEnabled && !item.embedding) {
            // Generate a very simple mock embedding based on content length and type
            const typeCode = item.type.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % 100;
            item.embedding = [item.content.length, Math.random(), typeCode / 100]; 
            console.log(`SemanticIndex: Generated mock embedding for item: ${item.id}`);
        }
        
        this.indexedItems.set(item.id, item);
        if (!existingItem) {
            console.log(`SemanticIndex: Indexed new item: ${item.id} - ${item.type}`);
        } else {
            console.log(`SemanticIndex: Updated existing item: ${item.id} - ${item.type}`);
        }
    }

    /**
     * Indexes multiple context items.
     * @param items An array of context items to index.
     */
    async indexItems(items: IContextItem[]): Promise<void> {
        for (const item of items) {
            await this.indexItem(item);
        }
        console.log(`SemanticIndex: Processed ${items.length} items for indexing.`);
    }

    /**
     * Performs a search for items matching the query.
     * This is a mocked search logic.
     * @param query The search query string.
     * @param limit The maximum number of results to return.
     * @returns A promise that resolves to an array of matching context items.
     */
    async search(query: string, limit: number = 5): Promise<IContextItem[]> {
        console.log(`SemanticIndex: Searching for: "${query}" with limit ${limit}.`);
        const lowerCaseQuery = query.toLowerCase();
        const results: IContextItem[] = [];

        for (const item of this.indexedItems.values()) {
            // Basic keyword search in content or ID
            if (item.content.toLowerCase().includes(lowerCaseQuery) || 
                item.id.toLowerCase().includes(lowerCaseQuery) ||
                (item.metadata?.filePath && String(item.metadata.filePath).toLowerCase().includes(lowerCaseQuery))
            ) {
                results.push(item);
            }
        }

        // Mocked similarity scoring if embeddings are enabled (very simplistic)
        if (this.mockEmbeddingsEnabled) {
            results.sort((a, b) => {
                // Prefer items where query terms appear more often (very naive score)
                const scoreA = (a.content.toLowerCase().split(lowerCaseQuery).length - 1) + 
                               (a.embedding ? a.embedding[1] * 0.1 : 0); // Add a bit of embedding randomness
                const scoreB = (b.content.toLowerCase().split(lowerCaseQuery).length - 1) +
                               (b.embedding ? b.embedding[1] * 0.1 : 0);
                return scoreB - scoreA; // Higher score first
            });
        }
        
        console.log(`SemanticIndex: Found ${results.length} potential matches for "${query}". Returning up to ${limit}.`);
        return results.slice(0, limit);
    }

    /**
     * Retrieves an item by its ID.
     * @param itemId The ID of the item to retrieve.
     * @returns The context item if found, otherwise undefined.
     */
    getItemById(itemId: string): IContextItem | undefined {
        return this.indexedItems.get(itemId);
    }

    /**
     * Clears all items from the index.
     */
    clearIndex(): void {
        this.indexedItems.clear();
        console.log("SemanticIndex: Index cleared.");
    }
}
```
