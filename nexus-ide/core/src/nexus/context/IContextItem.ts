export interface IContextItem {
    id: string; // Unique identifier for the context item
    type: string; // e.g., "file", "class", "function", "terminal_output", "web_search_result"
    content: string; // The textual content or a summary
    metadata?: Record<string, any>; // e.g., filePath, lineNumbers, source, timestamp
    embedding?: number[]; // Optional, for semantic search later
}
```
