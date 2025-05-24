// Ensure this script runs in strict mode
(function () {
    'use strict';

    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const agentSelector = document.getElementById('agentSelector');
    const initialInput = document.getElementById('initialInput');
    const runSimulationButton = document.getElementById('runSimulationButton');
    const pauseSimulationButton = document.getElementById('pauseSimulationButton');
    const resumeSimulationButton = document.getElementById('resumeSimulationButton');
    const stepSimulationButton = document.getElementById('stepSimulationButton');
    const stopSimulationButton = document.getElementById('stopSimulationButton');
    
    const simulationLogDiv = document.getElementById('simulationLog'); 
    const traceViewerDiv = document.getElementById('traceViewer'); 

    let currentSimState = 'idle'; // Possible states: idle, starting, running, paused, stepping, stopped, completed, error

    function updateButtonStates(newState) {
        currentSimState = newState;
        // Default all to disabled, then enable based on state
        runSimulationButton.disabled = true;
        pauseSimulationButton.disabled = true;
        resumeSimulationButton.disabled = true;
        stepSimulationButton.disabled = true;
        stopSimulationButton.disabled = true;

        switch (currentSimState) {
            case 'idle':
            case 'stopped':
            case 'completed':
            case 'error': 
                runSimulationButton.disabled = false;
                break;
            case 'starting': // Intermediate state while waiting for service
                // All controls might be disabled or just run
                // For now, keep them disabled until 'running' or 'error'
                break; 
            case 'running':
                pauseSimulationButton.disabled = false;
                stopSimulationButton.disabled = false;
                break;
            case 'paused':
                resumeSimulationButton.disabled = false;
                stepSimulationButton.disabled = false;
                stopSimulationButton.disabled = false;
                break;
            // 'stepping' state could be used if step action takes time and we want to disable other controls.
            // For now, assume a step leads back to 'paused' or another definitive state via status_update.
        }
    }
    
    function addSimulationLog(message, type = 'INFO') {
        if (simulationLogDiv) {
            const entry = document.createElement('div');
            entry.className = 'log-entry'; 
            const time = new Date().toLocaleTimeString();
            const sanitizedMessage = String(message).replace(/</g, "&lt;").replace(/>/g, "&gt;");
            entry.innerHTML = `<span class="timestamp">[${time}]</span> <span class="type-${type.toUpperCase()}">[${type.toUpperCase()}]</span> ${sanitizedMessage}`;
            const placeholder = simulationLogDiv.querySelector('p.log-entry');
            if (placeholder && placeholder.textContent.startsWith('General simulation status')) {
                simulationLogDiv.innerHTML = '';
            }
            simulationLogDiv.appendChild(entry);
            simulationLogDiv.scrollTop = simulationLogDiv.scrollHeight; 
        }
    }

    function addTraceEvent(event) {
        if (traceViewerDiv) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            const time = new Date(event.timestamp * 1000).toLocaleTimeString();
            const type = event.type ? String(event.type).toUpperCase() : 'UNKNOWN';
            let dataContent = event.data;
            if (typeof dataContent === 'object') {
                dataContent = JSON.stringify(dataContent, null, 2);
            }
            const sanitizedDataContent = String(dataContent).replace(/</g, "&lt;").replace(/>/g, "&gt;");
            entry.innerHTML = `<span class="timestamp">[${time}]</span> <span class="type-${type.replace('_', '')}">[${type}]</span> ${sanitizedDataContent}`; // Replaced _ for CSS class compatibility
            const placeholder = traceViewerDiv.querySelector('p.log-entry');
            if (placeholder && placeholder.textContent.startsWith('Trace events will appear')) {
                traceViewerDiv.innerHTML = '';
            }
            traceViewerDiv.appendChild(entry);
            traceViewerDiv.scrollTop = traceViewerDiv.scrollHeight;
        }
    }

    // Initial UI setup
    updateButtonStates('idle');
    vscode.postMessage({ command: 'uiReady' });
    addSimulationLog('UI ready. Requesting agent list...');

    runSimulationButton.addEventListener('click', () => {
        const selectedAgentId = agentSelector.value;
        const initialInputText = initialInput.value;

        if (!selectedAgentId) {
            vscode.postMessage({ command: 'showErrorUser', text: 'Please select an agent before running the simulation.' }); 
            addSimulationLog('Error: No agent selected for simulation.', 'ERROR');
            return;
        }
        if(simulationLogDiv) simulationLogDiv.innerHTML = '<p class="log-entry">General simulation status messages will appear here...</p>';
        if(traceViewerDiv) traceViewerDiv.innerHTML = '<p class="log-entry">Trace events will appear here...</p>';
        addSimulationLog('Cleared previous logs.');

        vscode.postMessage({
            command: 'runSimulation',
            agentId: selectedAgentId,
            initialInput: initialInputText
            // mockConfigs: {} // TODO: Add UI for mock configs if needed
        });
        addSimulationLog(`Run command sent for agent: ${selectedAgentId}. Waiting for service...`);
        updateButtonStates('starting'); 
    });

    pauseSimulationButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'controlSimulation', action: 'pause' });
        addSimulationLog('Pause command sent.');
        // UI state will be updated by 'simulationStateUpdate' from extension
    });

    resumeSimulationButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'controlSimulation', action: 'resume' });
        addSimulationLog('Resume command sent.');
    });

    stepSimulationButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'controlSimulation', action: 'step' });
        addSimulationLog('Step command sent.');
    });

    stopSimulationButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'controlSimulation', action: 'stop' });
        addSimulationLog('Stop command sent.');
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'populateAgentSelector':
                if (agentSelector) {
                    while (agentSelector.options.length > 1) agentSelector.remove(1); // Keep placeholder
                    if (message.agents && message.agents.length > 0) {
                        message.agents.forEach(agent => {
                            const option = document.createElement('option');
                            option.value = agent.id; 
                            option.textContent = agent.name;
                            agentSelector.appendChild(option);
                        });
                        addSimulationLog(`Agent list populated with ${message.agents.length} agents.`);
                    } else {
                        addSimulationLog('No agents found to populate selector.', 'WARNING');
                         const option = document.createElement('option');
                         option.textContent = "No agents found in workspace";
                         option.disabled = true;
                         agentSelector.appendChild(option);
                    }
                }
                break;
            case 'simulationLogEntry': 
                addSimulationLog(message.data, message.logType || 'INFO');
                break;
            case 'traceEvent': 
                addTraceEvent(message.event);
                // If the trace event itself is a status update from the service, reflect it in button states.
                if (message.event && message.event.type === 'status_update' && message.event.data && message.event.data.state) {
                    updateButtonStates(message.event.data.state);
                    // Optionally display message.event.data.message in simulationLogDiv as well
                    // addSimulationLog(`Status Update: ${message.event.data.state}. ${message.event.data.message || ''}`, 'INFO');
                }
                break;
            case 'simulationStateUpdate': // This is the primary message for updating button states
                updateButtonStates(message.state);
                if(message.message) { // Display message if provided with state update
                    addSimulationLog(`Simulation State: ${message.state}. ${message.message}`, 'INFO');
                } else {
                    addSimulationLog(`Simulation State: ${message.state}.`, 'INFO');
                }
                break;
            case 'showError': // For displaying errors from the extension in the log
                 addSimulationLog(message.text, 'ERROR');
                 updateButtonStates('error'); // Set a generic error state for buttons
                 break;
        }
    });

}());
```
