import { QuantumContext } from '../context/QuantumContext'; // Adjusted path

export interface AgentConfig {
    agentName: string;
    description?: string;
    corePrompt?: string; // Or a reference to a prompt file/template
    capabilities?: string[];
    tools?: string[]; // Names/IDs of tools this agent can use
    defaultModelId?: string; // e.g., "gpt-4-nexus", "claude-opus-nexus"
    // Add other common config properties
    version?: string;
    personaId?: string; // Reference to a persona definition
}

export interface AgentTask {
    taskId: string;
    description: string;
    userInput: any; // Could be a string, object, etc.
    priority?: 'low' | 'medium' | 'high';
    parentTaskId?: string;
    subTasks?: AgentTask[]; // For decomposition
    targetAgent?: string; // Hint for which agent should execute
    // Contextual overrides or specific context items for this task
    taskContext?: Record<string, any>; 
}

export interface AgentResult {
    taskId: string;
    status: 'success' | 'failure' | 'in_progress' | 'pending';
    output: any; // Can be any data type
    error?: string;
    logs?: string[]; // Agent-specific logs for this task execution
    nextTasks?: AgentTask[]; // For chaining or decomposing tasks
}

export interface IAgent {
    readonly config: AgentConfig;
    
    /**
     * Optional asynchronous initialization method for the agent.
     * Called once when the agent is registered or first used.
     */
    initialize?(): Promise<void>;

    /**
     * Executes a given task using the provided context.
     * This is the primary method for an agent to perform its function.
     * @param task The task to be executed.
     * @param context The QuantumContext providing relevant information.
     * @returns A promise that resolves to an AgentResult.
     */
    execute(task: AgentTask, context: QuantumContext): Promise<AgentResult>;

    // Optional methods for more complex agent loops (can be part of execute or separate):
    // /**
    //  * The thinking phase of the agent's execution loop.
    //  * @param task The current task.
    //  * @param context The current QuantumContext.
    //  * @returns A promise resolving to the agent's internal thoughts, plan, or next action decision.
    //  */
    // think?(task: AgentTask, context: QuantumContext): Promise<any>; 

    // /**
    //  * The acting phase, where the agent performs an action (e.g., calls a tool, generates content).
    //  * @param thoughtProcess The output from the think phase.
    //  * @param context The current QuantumContext.
    //  * @returns A promise resolving to the outcome of the action.
    //  */
    // act?(thoughtProcess: any, context: QuantumContext): Promise<any>; 

    // /**
    //  * The reflection phase, where the agent processes the outcome of its action.
    //  * This might involve updating its internal state, memory, or learning.
    //  * @param actionOutcome The result from the act phase.
    //  * @param context The current QuantumContext.
    //  * @returns A promise that resolves when reflection is complete.
    //  */
    // reflect?(actionOutcome: any, context: QuantumContext): Promise<void>; 

    /**
     * Optional asynchronous cleanup method for the agent.
     * Called when the agent is being unregistered or the system is shutting down.
     */
    destroy?(): Promise<void>;
}
```
