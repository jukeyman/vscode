import { IAgent, AgentConfig, AgentTask, AgentResult } from './IAgent';
import { QuantumContext } from '../context/QuantumContext'; // Adjusted path

export abstract class BaseAgent implements IAgent {
    public readonly config: AgentConfig;

    constructor(config: AgentConfig) {
        this.config = config;
        this.log(`Agent '${this.config.agentName}' created.`);
    }

    async initialize(): Promise<void> {
        this.log("Initializing...");
        // Placeholder for common initialization logic or to be overridden by subclasses
        // For example, loading specific resources or models based on config.
        return Promise.resolve();
    }

    abstract execute(task: AgentTask, context: QuantumContext): Promise<AgentResult>;

    async destroy(): Promise<void> {
        this.log("Destroying...");
        // Placeholder for common cleanup logic
        return Promise.resolve();
    }

    /**
     * Logs a message with the agent's name prefix.
     * @param message The message to log.
     * @param data Optional additional data to log (will be stringified if an object).
     */
    protected log(message: string, data?: any): void {
        const agentNamePrefix = `[${this.config.agentName}]`;
        if (data !== undefined) {
            if (typeof data === 'object' && data !== null) {
                try {
                    console.log(`${agentNamePrefix} ${message}`, JSON.stringify(data, null, 2));
                } catch (e) {
                    console.log(`${agentNamePrefix} ${message}`, data); // Fallback if stringify fails
                }
            } else {
                console.log(`${agentNamePrefix} ${message}`, data);
            }
        } else {
            console.log(`${agentNamePrefix} ${message}`);
        }
    }

    // Optional: Example of how think, act, reflect could be structured if not abstract
    // These would typically be part of a more complex agent's internal execution flow
    // or called by a more sophisticated orchestrator.

    // protected async think(task: AgentTask, context: QuantumContext): Promise<any> {
    //     this.log(`Thinking for task: ${task.description}`);
    //     // Subclasses would implement their specific thinking logic
    //     return { plan: "generated_plan_based_on_task_and_context" };
    // }

    // protected async act(thoughtProcess: any, context: QuantumContext): Promise<any> {
    //     this.log(`Acting based on thought:`, thoughtProcess);
    //     // Subclasses would implement action execution (e.g., tool use, content generation)
    //     return { actionResult: "result_of_action" };
    // }

    // protected async reflect(actionOutcome: any, context: QuantumContext): Promise<void> {
    //     this.log(`Reflecting on action outcome:`, actionOutcome);
    //     // Subclasses would implement reflection logic (e.g., update internal state, learn)
    // }
}
```
