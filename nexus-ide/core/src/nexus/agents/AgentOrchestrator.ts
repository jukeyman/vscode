import { IAgent, AgentConfig, AgentTask, AgentResult } from './IAgent';
import { AgentBus } from './AgentBus';
import { QuantumContext } from '../context/QuantumContext';
import { ModelRouter } from '../ai/ModelRouter';

export class AgentOrchestrator {
    private agents: Map<string, IAgent> = new Map();
    private agentBus: AgentBus;
    private quantumContext: QuantumContext;
    private modelRouter: ModelRouter;

    constructor(agentBus: AgentBus, quantumContext: QuantumContext, modelRouter: ModelRouter) {
        this.agentBus = agentBus;
        this.quantumContext = quantumContext;
        this.modelRouter = modelRouter;
        this.log("AgentOrchestrator initialized with AgentBus, QuantumContext, and ModelRouter.");
    }

    async registerAgent(agent: IAgent): Promise<void> {
        if (!agent || !agent.config || !agent.config.agentName) {
            this.logError("Attempted to register an invalid agent or agent with no name.");
            return;
        }

        if (this.agents.has(agent.config.agentName)) {
            this.logWarn(`Agent '${agent.config.agentName}' is already registered. Re-registering (will overwrite).`);
        }

        this.agents.set(agent.config.agentName, agent);

        if (agent.initialize) {
            try {
                // If initialize requires extensionUri (like ArchitectAgent does for loading files),
                // this needs to be handled. For now, assume initialize can be called without it
                // or that it's passed via agent config if needed by specific agents.
                // For ArchitectAgent, its initialize was designed to take an optional vscode.Uri.
                // This implies the orchestrator might need access to extension context or pass it.
                // For simplicity here, we call it without. If agent.initialize MUST have it,
                // this registration or agent's initialize signature needs adjustment.
                await agent.initialize();
                this.log(`Agent '${agent.config.agentName}' initialized.`);
            } catch (error) {
                this.logError(`Error initializing agent '${agent.config.agentName}':`, error);
            }
        }
        this.log(`Agent '${agent.config.agentName}' registered successfully.`);
        this.agentBus.publish("agentRegistered", { agentName: agent.config.agentName });
    }

    async unregisterAgent(agentName: string): Promise<void> {
        const agent = this.agents.get(agentName);
        if (agent) {
            if (agent.destroy) {
                try {
                    await agent.destroy();
                    this.log(`Agent '${agentName}' destroyed.`);
                } catch (error) {
                    this.logError(`Error destroying agent '${agentName}':`, error);
                }
            }
            this.agents.delete(agentName);
            this.log(`Agent '${agentName}' unregistered.`);
            this.agentBus.publish("agentUnregistered", { agentName });
        } else {
            this.logWarn(`Agent '${agentName}' not found for unregistration.`);
        }
    }

    async dispatchTask(task: AgentTask, targetAgentName?: string): Promise<AgentResult> {
        let agentToExecute: IAgent | undefined;
        let agentNameForExecution = targetAgentName;

        if (agentNameForExecution) {
            agentToExecute = this.agents.get(agentNameForExecution);
            if (!agentToExecute) {
                this.logError(`Target agent '${agentNameForExecution}' not found for task '${task.taskId}'.`);
                return this.createFailureResult(task.taskId, `Agent '${agentNameForExecution}' not found.`);
            }
        } else {
            // Enhanced routing: Check for specific keywords for ArchitectAgent
            if (task.description.toLowerCase().includes("design system") ||
                task.description.toLowerCase().includes("blueprint") ||
                task.description.toLowerCase().includes("/design_system")) {
                agentToExecute = this.agents.get("ArchitectAgent");
                agentNameForExecution = "ArchitectAgent";
                if (agentToExecute) {
                    this.log(`Routing task '${task.taskId}' to ArchitectAgent due to keywords.`);
                }
            }

            if (!agentToExecute) { // Fallback to first available if no specific routing matched
                if (this.agents.size > 0) {
                    const firstAgentEntry = this.agents.entries().next();
                    if (firstAgentEntry.value) {
                        agentToExecute = firstAgentEntry.value[1];
                        agentNameForExecution = firstAgentEntry.value[0];
                        this.log(`No target agent specified for task '${task.taskId}'. Routing to first available agent: '${agentNameForExecution}'.`);
                    }
                }
            }

            if (!agentToExecute || !agentNameForExecution) {
                this.logError(`No agent available or routed to handle task '${task.taskId}'.`);
                return this.createFailureResult(task.taskId, "No available agent to handle the task.");
            }
        }

        this.log(`Dispatching task '${task.taskId}' to agent '${agentNameForExecution}'. Description: "${task.description}"`);
        this.agentBus.publish("taskDispatched", { taskId: task.taskId, agentName: agentNameForExecution, taskDescription: task.description });

        try {
            // Pass the QuantumContext. ModelRouter is already available to ArchitectAgent via its constructor.
            const result = await agentToExecute.execute(task, this.quantumContext);
            this.agentBus.publish("taskCompleted", { taskId: task.taskId, agentName: agentNameForExecution, status: result.status, resultSummary: this.summarizeOutput(result.output) });
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logError(`Error executing task '${task.taskId}' on agent '${agentNameForExecution}':`, error);
            this.agentBus.publish("taskFailed", { taskId: task.taskId, agentName: agentNameForExecution, error: errorMsg });
            return this.createFailureResult(task.taskId, `Execution error on agent '${agentNameForExecution}': ${errorMsg}`);
        }
    }

    async orchestrateComplexTask(initialTask: AgentTask): Promise<AgentResult> {
        this.log(`Orchestrating complex task: ${initialTask.description}`);
        this.agentBus.publish("complexTaskStarted", { taskId: initialTask.taskId, description: initialTask.description });
        const result = await this.dispatchTask(initialTask, initialTask.targetAgent); // Simple dispatch for now
        this.agentBus.publish("complexTaskEnded", { taskId: initialTask.taskId, status: result.status, finalOutputSummary: this.summarizeOutput(result.output) });
        return result;
    }

    getAgent(agentName: string): IAgent | undefined {
        return this.agents.get(agentName);
    }

    listRegisteredAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    private createFailureResult(taskId: string, error: string): AgentResult {
        return { taskId, status: 'failure', error, output: null };
    }

    private summarizeOutput(output: any): string {
        if (!output) return "N/A";
        if (typeof output === 'string') return output.substring(0, 100) + (output.length > 100 ? "..." : "");
        if (output.blueprintYaml && typeof output.blueprintYaml === 'string') return `Blueprint YAML (first 100 chars): ${output.blueprintYaml.substring(0,100)}...`;
        if (output.blueprintObject && output.blueprintObject.metadata) return `Blueprint: ${output.blueprintObject.metadata.blueprintName} v${output.blueprintObject.metadata.blueprintVersion}`;
        return JSON.stringify(output).substring(0,100) + "...";
    }

    private log(message: string, data?: any): void {
        const prefix = "[AgentOrchestrator]";
        if (data !== undefined) { console.log(`${prefix} ${message}`, data); }
        else { console.log(`${prefix} ${message}`); }
        // aiOutputChannel?.appendLine(`${prefix} ${message} ${data ? JSON.stringify(data) : ''}`); // If aiOutputChannel is accessible
    }
    private logWarn(message: string, data?: any): void {
        const prefix = "[AgentOrchestrator Warning]";
        if (data !== undefined) { console.warn(`${prefix} ${message}`, data); }
        else { console.warn(`${prefix} ${message}`); }
    }
    private logError(message: string, data?: any): void {
        const prefix = "[AgentOrchestrator Error]";
        if (data !== undefined) { console.error(`${prefix} ${message}`, data); }
        else { console.error(`${prefix} ${message}`); }
    }
}
```

**3. `nexus-ide/core/src/nexus/ui/webviews/chat/ChatViewProvider.ts`**
