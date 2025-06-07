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

        // Initialization (like loading prompts) is expected to be called in extension.ts
        // using agent.initialize(context.extensionUri) before this registration.
        this.log(`Agent '${agent.config.agentName}' registered successfully (assumed pre-initialized if needed).`);
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
            // Task-based routing
            const taskDescLower = task.description.toLowerCase();
            if (taskDescLower.includes("design system") ||
                taskDescLower.includes("blueprint") ||
                taskDescLower.includes("/design_system")) {
                agentToExecute = this.agents.get("ArchitectAgent");
                agentNameForExecution = "ArchitectAgent";
                if (agentToExecute) {
                    this.log(`Routing task '${task.taskId}' to ArchitectAgent due to design keywords.`);
                }
            } else if (taskDescLower.includes("generate backend for blueprint") ||
                       taskDescLower.includes("/generate_backend") ||
                       (task.userInput?.blueprint?.backendSpecification)) {
                agentToExecute = this.agents.get("BackendForgeAgent");
                agentNameForExecution = "BackendForgeAgent";
                if (agentToExecute) {
                    this.log(`Routing task '${task.taskId}' to BackendForgeAgent due to backend generation keywords.`);
                }
            } else if (taskDescLower.includes("generate frontend for blueprint") ||
                       taskDescLower.includes("/generate_frontend") ||
                       (task.userInput?.blueprint?.frontendSpecification)) {
                agentToExecute = this.agents.get("FrontendForgeAgent");
                agentNameForExecution = "FrontendForgeAgent";
                if (agentToExecute) {
                    this.log(`Routing task '${task.taskId}' to FrontendForgeAgent due to frontend generation keywords.`);
                }
            } else if (taskDescLower.includes("generate database for blueprint") ||
                       taskDescLower.includes("/generate_database") ||
                       (task.userInput?.blueprint?.databaseSpecification)) {
                agentToExecute = this.agents.get("DatabaseForgeAgent");
                agentNameForExecution = "DatabaseForgeAgent";
                if (agentToExecute) {
                    this.log(`Routing task '${task.taskId}' to DatabaseForgeAgent due to database generation keywords.`);
                }
            }
            // Add more routing rules for other agents here...

            if (!agentToExecute) { // Fallback if no specific routing matched
                if (this.agents.size > 0) {
                    const firstAgentEntry = this.agents.entries().next();
                    if (firstAgentEntry.value) {
                        agentToExecute = firstAgentEntry.value[1];
                        agentNameForExecution = firstAgentEntry.value[0];
                        this.log(`No specific routing matched for task '${task.taskId}'. Routing to first available agent: '${agentNameForExecution}'.`);
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
        const result = await this.dispatchTask(initialTask, initialTask.targetAgent);
        this.agentBus.publish("complexTaskEnded", { taskId: initialTask.taskId, status: result.status, finalOutputSummary: this.summarizeOutput(result.output) });
        return result;
    }

    getAgent(agentName: string): IAgent | undefined {
        return this.agents.get(agentName);
    }

    listRegisteredAgentNames(): string[] {
        return Array.from(this.agents.keys());
    }

    private createFailureResult(taskId: string, error: string, output: any = null): AgentResult {
        return { taskId, status: 'failure', error, output };
    }

    private summarizeOutput(output: any): string {
        if (!output) return "N/A";
        if (typeof output === 'string') return output.substring(0, 100) + (output.length > 100 ? "..." : "");
        if (output.blueprintYaml && typeof output.blueprintYaml === 'string') return `Blueprint YAML (first 100 chars): ${output.blueprintYaml.substring(0,100)}...`;
        if (output.blueprintObject && output.blueprintObject.projectMetadata) return `Blueprint: ${output.blueprintObject.projectMetadata.projectName || output.blueprintObject.projectMetadata.blueprintName}`;
        if (output.fileSet && typeof output.fileSet === 'object') {
            const fileCount = Object.keys(output.fileSet).length;
            return `Generated ${fileCount} files. (${Object.keys(output.fileSet).slice(0,2).join(', ')}${fileCount > 2 ? '...' : ''})`;
        }
        return JSON.stringify(output).substring(0,100) + "...";
    }

    private log(message: string, data?: any): void {
        const prefix = "[AgentOrchestrator]";
        if (data !== undefined) { console.log(`${prefix} ${message}`, data); }
        else { console.log(`${prefix} ${message}`); }
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
