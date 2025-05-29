import { IAgent, AgentConfig, AgentTask, AgentResult } from './IAgent';
import { AgentBus } from './AgentBus';
import { QuantumContext } from '../context/QuantumContext'; // Adjusted path
import { ModelRouter } from '../ai/ModelRouter'; // Adjusted path

export class AgentOrchestrator {
    private agents: Map<string, IAgent> = new Map();
    private agentBus: AgentBus;
    private quantumContext: QuantumContext;
    private modelRouter: ModelRouter; 

    constructor(agentBus: AgentBus, quantumContext: QuantumContext, modelRouter: ModelRouter) {
        this.agentBus = agentBus;
        this.quantumContext = quantumContext;
        this.modelRouter = modelRouter; // Store the modelRouter instance
        console.log("[AgentOrchestrator] Initialized with AgentBus, QuantumContext, and ModelRouter.");
    }

    /**
     * Registers an agent with the orchestrator.
     * @param agent The agent instance to register.
     */
    async registerAgent(agent: IAgent): Promise<void> {
        if (!agent || !agent.config || !agent.config.agentName) {
            console.error("[AgentOrchestrator] Attempted to register an invalid agent or agent with no name.");
            return;
        }

        if (this.agents.has(agent.config.agentName)) {
            console.warn(`[AgentOrchestrator] Agent '${agent.config.agentName}' is already registered. Re-registering (will overwrite).`);
        }

        this.agents.set(agent.config.agentName, agent);
        
        if (agent.initialize) {
            try {
                await agent.initialize();
                console.log(`[AgentOrchestrator] Agent '${agent.config.agentName}' initialized.`);
            } catch (error) {
                console.error(`[AgentOrchestrator] Error initializing agent '${agent.config.agentName}':`, error);
                // Optionally, unregister if initialization fails critically
                // this.agents.delete(agent.config.agentName);
            }
        }
        console.log(`[AgentOrchestrator] Agent '${agent.config.agentName}' registered successfully.`);
        this.agentBus.publish("agentRegistered", { agentName: agent.config.agentName });
    }

    /**
     * Unregisters an agent.
     * @param agentName The name of the agent to unregister.
     */
    async unregisterAgent(agentName: string): Promise<void> {
        const agent = this.agents.get(agentName);
        if (agent) {
            if (agent.destroy) {
                try {
                    await agent.destroy();
                    console.log(`[AgentOrchestrator] Agent '${agentName}' destroyed.`);
                } catch (error) {
                    console.error(`[AgentOrchestrator] Error destroying agent '${agentName}':`, error);
                }
            }
            this.agents.delete(agentName);
            console.log(`[AgentOrchestrator] Agent '${agentName}' unregistered.`);
            this.agentBus.publish("agentUnregistered", { agentName });
        } else {
            console.warn(`[AgentOrchestrator] Agent '${agentName}' not found for unregistration.`);
        }
    }

    /**
     * Dispatches a task to a target agent or routes it if no target is specified.
     * @param task The task to be dispatched.
     * @param targetAgentName Optional name of the target agent.
     * @returns A promise that resolves to an AgentResult.
     */
    async dispatchTask(task: AgentTask, targetAgentName?: string): Promise<AgentResult> {
        let agentToExecute: IAgent | undefined;

        if (targetAgentName) {
            agentToExecute = this.agents.get(targetAgentName);
            if (!agentToExecute) {
                console.error(`[AgentOrchestrator] Target agent '${targetAgentName}' not found for task '${task.taskId}'.`);
                return {
                    taskId: task.taskId,
                    status: 'failure',
                    error: `Agent '${targetAgentName}' not found.`,
                    output: null,
                };
            }
        } else {
            // Basic routing logic: Use the first registered agent if no target specified.
            // More sophisticated routing can be implemented here based on task.description, capabilities, etc.
            if (this.agents.size > 0) {
                // Fallback to the first registered agent for now
                const firstAgentEntry = this.agents.entries().next();
                if (firstAgentEntry.value) {
                    agentToExecute = firstAgentEntry.value[1]; // Get the agent instance
                    targetAgentName = firstAgentEntry.value[0]; // Get the agent name (key)
                    console.log(`[AgentOrchestrator] No target agent specified for task '${task.taskId}'. Routing to first available agent: '${targetAgentName}'.`);
                }
            }
            
            if (!agentToExecute) {
                console.error(`[AgentOrchestrator] No agent available to handle task '${task.taskId}'.`);
                return {
                    taskId: task.taskId,
                    status: 'failure',
                    error: "No available agent to handle the task.",
                    output: null,
                };
            }
        }
        
        console.log(`[AgentOrchestrator] Dispatching task '${task.taskId}' to agent '${targetAgentName}'.`);
        this.agentBus.publish("taskDispatched", { taskId: task.taskId, agentName: targetAgentName, taskDescription: task.description });

        try {
            // Provide the ModelRouter to the agent through the QuantumContext, if the agent needs it.
            // This is a conceptual way; QuantumContext might need a method to set/get ModelRouter,
            // or agents might access it through a global service locator if that pattern is used.
            // For now, we assume agents can access it if they need it, or it's implicitly available.
            // The QuantumContext passed here is the one initialized in the constructor.
            const result = await agentToExecute.execute(task, this.quantumContext);
            this.agentBus.publish("taskCompleted", { taskId: task.taskId, agentName: targetAgentName, status: result.status, resultSummary: result.output ? String(result.output).substring(0,100) + "..." : "N/A" });
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[AgentOrchestrator] Error executing task '${task.taskId}' on agent '${targetAgentName}':`, error);
            this.agentBus.publish("taskFailed", { taskId: task.taskId, agentName: targetAgentName, error: errorMsg });
            return {
                taskId: task.taskId,
                status: 'failure',
                error: `Execution error on agent '${targetAgentName}': ${errorMsg}`,
                output: null,
            };
        }
    }

    /**
     * Conceptual method for orchestrating complex tasks that might involve multiple agents
     * or a sequence of sub-tasks.
     * @param initialTask The initial high-level task.
     * @returns A promise that resolves to the final AgentResult of the complex task.
     */
    async orchestrateComplexTask(initialTask: AgentTask): Promise<AgentResult> {
        this.log(`Orchestrating complex task: ${initialTask.description}`);
        this.agentBus.publish("complexTaskStarted", { taskId: initialTask.taskId, description: initialTask.description });

        // STUB: This is a placeholder for more complex logic.
        // For example, it could:
        // 1. Decompose initialTask into subTasks.
        // 2. Dispatch subTasks to appropriate agents (sequentially or in parallel).
        // 3. Aggregate results from subTasks.
        // 4. Handle errors and retries for subTasks.

        // For now, just dispatch it as a simple task to a default or specified agent.
        const result = await this.dispatchTask(initialTask, initialTask.targetAgent);

        this.agentBus.publish("complexTaskEnded", { taskId: initialTask.taskId, status: result.status, finalOutputSummary: result.output ? String(result.output).substring(0,100) + "..." : "N/A" });
        return result;
    }

    /**
     * Retrieves a registered agent instance by its name.
     * @param agentName The name of the agent.
     * @returns The IAgent instance or undefined.
     */
    getAgent(agentName: string): IAgent | undefined {
        return this.agents.get(agentName);
    }

    /**
     * Lists the names of all registered agents.
     * @returns An array of agent names.
     */
    listRegisteredAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    private log(message: string, data?: any): void {
        const prefix = "[AgentOrchestrator]";
        if (data !== undefined) {
            console.log(`${prefix} ${message}`, data);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }
}
```
