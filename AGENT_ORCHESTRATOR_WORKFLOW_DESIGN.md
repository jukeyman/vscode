# Agent Orchestrator Workflow Design

This document outlines the design for enhancing `AgentOrchestrator.ts` to support the execution of sequential, multi-agent workflows. The core idea is to allow the output of one agent in a sequence to be used as input for subsequent agents, enabling more complex, chained operations.

## 1. Core Interfaces for Workflow Definition

To define a workflow, we need to describe each step, including the agent to be called and how its inputs are constructed from previous steps or initial data.

### `AgentWorkflowInputSource` Interface

This interface defines the source for a specific input field required by an agent in a workflow step.

```typescript
interface AgentWorkflowInputSource {
    /**
     * ID of a previous step in the workflow whose output should be used.
     * If specified, sourceOutputKey or a transformation function might be needed.
     */
    sourceStepId?: string;

    /**
     * Key/path (e.g., using dot notation like 'data.user.id') to extract a specific value
     * from the output of the step identified by `sourceStepId`.
     * If not provided and `sourceStepId` is, the entire output of the source step might be used.
     */
    sourceOutputKey?: string;

    /**
     * Allows providing a static, direct value for an input field.
     */
    directValue?: any;

    /**
     * Key/path (e.g., 'initialUserInput.customerQuery') to extract a value
     * from the `userInput` of the initial task that triggered the workflow.
     */
    fromInitialTask?: string;

    /**
     * (Advanced/Future) A function name or identifier for a registered transformation function
     * to process the sourced value before it's passed to the agent.
     * e.g., "extractEmails", "formatAsJsonString"
     */
    // transformFunction?: string;
}
```

### `AgentWorkflowStep` Interface

This interface defines a single step within a multi-agent workflow.

```typescript
interface AgentWorkflowStep {
    /** Unique identifier for this step within the workflow definition. */
    stepId: string;

    /** Name of the registered agent to execute for this step. */
    agentName: string;

    /** A description of what this specific agent task aims to achieve in the context of the workflow. */
    taskDescription: string;

    /**
     * Defines how to construct the `userInput` object for the agent's task in this step.
     * Each key in this record corresponds to an expected field in the target agent's `task.userInput`.
     * The value (AgentWorkflowInputSource) specifies where to get the data for that field.
     */
    inputMapping: Record<string, AgentWorkflowInputSource>;

    /**
     * (Optional) If true, a failure in this step will not halt the entire workflow.
     * Defaults to false (workflow stops on failure).
     */
    continueOnError?: boolean;

    /**
     * (Optional) Conditions for running this step, based on outputs of previous steps.
     * Example: { requiredOutputFromStep: "stepA", key: "status", expectedValue: "completed" }
     * This is an advanced feature for future consideration.
     */
    // runConditions?: any;

    /**
     * (Optional) Hints for how to parse or transform the output of this step before
     * it's stored or used by subsequent steps.
     * e.g., { extractKey: "generatedCode", expectedType: "string" }
     * This is an advanced feature for future consideration.
     */
    // outputProcessingHints?: any;
}
```

## 2. New Orchestrator Method: `executeWorkflow`

A new public method will be added to `AgentOrchestrator.ts` to handle the execution of defined workflows.

### Proposed Signature:

```typescript
// To be added to AgentOrchestrator class

/**
 * Represents the overall result of a workflow execution.
 */
interface OverallWorkflowResult {
    workflowId: string;
    status: 'success' | 'failure' | 'partially_completed';
    message?: string; // Overall message, e.g., "Workflow completed successfully" or error summary
    resultsByStep: Record<string, AgentResult>; // Stores the AgentResult for each executed step
    errorStepId?: string; // If status is 'failure', identifies the step that failed
}

async executeWorkflow(
    workflowId: string, // A unique identifier for this specific execution instance of a workflow
    initialWorkflowTask: AgentTask, // The initial task that provides overall context and initial inputs
    workflowDefinition: AgentWorkflowStep[] // The array of steps defining the workflow logic
): Promise<OverallWorkflowResult>;
```

## 3. Workflow Execution Logic

The `executeWorkflow` method will process the `workflowDefinition` step-by-step:

1.  **Initialization:**
    *   Create `resultsByStep: Record<string, AgentResult> = {};`. This will store the outcome of each step.
    *   Log the start of the workflow execution with `workflowId` and the description from `initialWorkflowTask`.
    *   Publish a `workflowStarted` event via `AgentBus`.

2.  **Iterate Through Steps:**
    *   For each `step` in `workflowDefinition`:
        *   Log the start of processing `step.stepId`.
        *   Publish a `workflowStepStarted` event.

        *   **Construct `currentStepTaskInput: Record<string, any> = {};` for the current agent:**
            *   Iterate through each `[inputField, sourceDefinition]` pair in `step.inputMapping`.
            *   **Resolve Input Value based on `sourceDefinition`:**
                *   If `sourceDefinition.fromInitialTask`:
                    *   Use a utility (e.g., `lodash.get` or a simple custom path resolver) to extract the value from `initialWorkflowTask.userInput` using `sourceDefinition.fromInitialTask` as the path.
                    *   Log where the input was sourced from.
                *   If `sourceDefinition.sourceStepId`:
                    *   Check if `resultsByStep[sourceDefinition.sourceStepId]` exists. If not, this is a workflow definition error (or a prior step failed and was not handled as "continueOnError"). Log an error and potentially halt the workflow (unless this step is optional or has fallback).
                    *   If the source step's result exists and its status was 'success':
                        *   If `sourceDefinition.sourceOutputKey`, use the utility to extract the value from `resultsByStep[sourceDefinition.sourceStepId].output` using `sourceDefinition.sourceOutputKey` as the path.
                        *   If `sourceDefinition.sourceOutputKey` is not provided, the entire `resultsByStep[sourceDefinition.sourceStepId].output` object is used.
                    *   If the source step failed (`status !== 'success'`) and this input is critical, the current step might need to be skipped or the workflow might fail (depends on `continueOnError` for the source step and error handling strategy).
                    *   Log where the input was sourced from.
                *   If `sourceDefinition.directValue`:
                    *   Use `sourceDefinition.directValue` directly.
                *   *(Future: If `sourceDefinition.transformFunction`, apply the named transformation to the resolved value.)*
                *   Assign the resolved value to `currentStepTaskInput[inputField]`. If a value could not be resolved and is critical, handle the error.

        *   **Create `AgentTask` for the current step:**
            ```typescript
            const currentAgentTask: AgentTask = {
                taskId: `${workflowId}_${step.stepId}`, // Ensure unique task ID for this step execution
                description: step.taskDescription,
                userInput: currentStepTaskInput,
                priority: initialWorkflowTask.priority, // Inherit or define per step
                parentTaskId: initialWorkflowTask.taskId // Link to the overall workflow task
            };
            ```

        *   **Dispatch the Task:**
            `const stepResult = await this.dispatchTask(currentAgentTask, step.agentName);`
            (This uses the existing `dispatchTask` method which handles execution by a single named agent).

        *   **Store and Log Result:**
            `resultsByStep[step.stepId] = stepResult;`
            Log the outcome of the step (success or failure, brief summary of output/error).
            Publish a `workflowStepCompleted` event with `stepId`, `status`, and `result`.

        *   **Handle Step Failure:**
            *   If `stepResult.status === 'failure'`:
                *   If `step.continueOnError` is `true`, log the failure but allow the workflow to proceed to the next step. The `resultsByStep` will reflect this step's failure.
                *   If `step.continueOnError` is `false` (or undefined), immediately stop the workflow. Publish a `workflowFailed` event. Return an `OverallWorkflowResult` with `status: 'failure'`, `message: "Workflow failed at step: " + step.stepId`, `resultsByStep`, and `errorStepId: step.stepId`.

3.  **Finalize Workflow:**
    *   If the loop completes without a critical failure:
        *   Publish a `workflowSucceeded` event.
        *   Return an `OverallWorkflowResult` with `status: 'success'`, `message: "Workflow completed successfully."`, and `resultsByStep`.
    *   If some optional steps failed but the workflow was allowed to continue, the status might be `partially_completed`.

## 4. State Management for Workflows (Conceptual)

*   **Initial Implementation (Blocking):** The `executeWorkflow` method as designed above is a single, potentially long-running, blocking (asynchronous) call. The state is managed within the scope of this call (`resultsByStep`). This is suitable for workflows that are expected to complete relatively quickly.
*   **Future Enhancements (Inspectable, Pausable):**
    *   **Workflow State Object:** For long-running, pausable, or resumable workflows, a dedicated state object/class per workflow execution would be needed. This object could be stored in memory (e.g., in a `Map<string, WorkflowState>` within the `AgentOrchestrator`) or persisted to a database.
    *   **State Properties:** Such an object might include `workflowId`, `definition`, `status` ('pending', 'running', 'paused', 'completed', 'failed'), `currentStepId`, `resultsByStep`, `errorInfo`, `createdAt`, `updatedAt`.
    *   **Persistence:** For resilience across orchestrator restarts, this state would need to be saved to a persistent store (e.g., Redis, a simple file DB, or a full database).
    *   **Control Endpoints:** New API endpoints (if the orchestrator is part of a service) or commands would be needed to pause, resume, or cancel persisted workflows.

## 5. Error Handling & Rollback (Conceptual)

*   **Current Design:** The current design focuses on a `continueOnError` flag per step. If a step fails and is not marked to continue, the workflow halts.
*   **Transactionality/Compensation (Advanced):**
    *   True rollback (undoing actions of previous steps) is highly complex, especially if agents interact with external systems.
    *   A more feasible approach for some workflows could be **compensation logic**: for certain critical steps, define a "compensating step" (another `AgentWorkflowStep`) that is triggered if a subsequent step fails. This is akin to the Saga pattern.
    *   This would require extending `AgentWorkflowStep` to include `onFailure?: { compensatoryStepId?: string; }` and modifying the execution loop to handle these.
*   **Idempotency:** Designing individual agent tasks to be idempotent (callable multiple times with the same input yielding the same result without unintended side effects) can simplify recovery from transient failures.

This design provides a foundational approach for sequential multi-agent workflows. Advanced features like parallel step execution, complex conditional logic, and robust state persistence can be layered on top of this initial structure.
```
