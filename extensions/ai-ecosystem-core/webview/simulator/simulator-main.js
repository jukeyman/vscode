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
    const traceViewerDiv = document.getElementById('traceViewer'); // New trace viewer div

    // Function to add a general log entry to the Simulation Log UI
    function addSimulationLog(message, type = 'INFO') {
        if (simulationLogDiv) {
            const entry = document.createElement('div');
            entry.className = 'log-entry'; // Apply base style
            
            const time = new Date().toLocaleTimeString();
            // Simple text sanitization
            const sanitizedMessage = String(message).replace(/</g, "&lt;").replace(/>/g, "&gt;");
            
            entry.innerHTML = `<span class="timestamp">[${time}]</span> <span class="type-${type.toUpperCase()}">[${type.toUpperCase()}]</span> ${sanitizedMessage}`;
            
            // Clear placeholder if it's the first real message
            const placeholder = simulationLogDiv.querySelector('p.log-entry');
            if (placeholder && placeholder.textContent.startsWith('General simulation status')) {
                simulationLogDiv.innerHTML = '';
            }
            simulationLogDiv.appendChild(entry);
            simulationLogDiv.scrollTop = simulationLogDiv.scrollHeight; 
        }
    }

    // Function to add a trace event to the Trace Viewer UI
    function addTraceEvent(event) {
        if (traceViewerDiv) {
            const entry = document.createElement('div');
            entry.className = 'log-entry'; // Apply base style
            
            const time = new Date(event.timestamp * 1000).toLocaleTimeString(); // Assuming timestamp is Unix seconds
            const type = event.type ? String(event.type).toUpperCase() : 'UNKNOWN';
            let dataContent = event.data;

            if (typeof dataContent === 'object') {
                dataContent = JSON.stringify(dataContent, null, 2); // Pretty print JSON
            }
            // Simple text sanitization
            const sanitizedDataContent = String(dataContent).replace(/</g, "&lt;").replace(/>/g, "&gt;");

            // Use the specific class for the event type for styling
            entry.innerHTML = `<span class="timestamp">[${time}]</span> <span class="type-${type}">[${type}]</span> ${sanitizedDataContent}`;
            
             // Clear placeholder if it's the first real message
            const placeholder = traceViewerDiv.querySelector('p.log-entry');
            if (placeholder && placeholder.textContent.startsWith('Trace events will appear')) {
                traceViewerDiv.innerHTML = '';
            }
            traceViewerDiv.appendChild(entry);
            traceViewerDiv.scrollTop = traceViewerDiv.scrollHeight;
        }
    }

    // Request agent list when UI is ready
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
        // Clear previous logs on new run
        if(simulationLogDiv) simulationLogDiv.innerHTML = '<p class="log-entry">General simulation status messages will appear here...</p>';
        if(traceViewerDiv) traceViewerDiv.innerHTML = '<p class="log-entry">Trace events will appear here...</p>';
        addSimulationLog('Cleared previous logs.');


        vscode.postMessage({
            command: 'runSimulation',
            agentId: selectedAgentId,
            initialInput: initialInputText
        });
        addSimulationLog(`Run command sent for agent: ${selectedAgentId}`);
    });

    pauseSimulationButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'controlSimulation', action: 'pause' });
        addSimulationLog('Pause command sent.');
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
                    while (agentSelector.options.length > 1) agentSelector.remove(1);
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
            case 'simulationLogEntry': // For general status messages
                addSimulationLog(message.data, message.logType || 'INFO'); // logType can be INFO, WARNING, ERROR
                break;
            case 'traceEvent': // For detailed agent trace
                addTraceEvent(message.event);
                break;
            case 'simulationStateUpdate':
                addSimulationLog(`Simulation state received: ${message.state}`, 'INFO');
                runSimulationButton.disabled = message.state === 'running' || message.state === 'paused';
                pauseSimulationButton.disabled = message.state !== 'running';
                resumeSimulationButton.disabled = message.state !== 'paused';
                stepSimulationButton.disabled = message.state !== 'paused'; // Can step when paused
                stopSimulationButton.disabled = message.state === 'stopped' || message.state === 'error' || message.state === 'completed';
                
                // If state is error, completed or stopped, ensure Run is enabled and others are sensible
                if (message.state === 'error' || message.state === 'completed' || message.state === 'stopped') {
                    runSimulationButton.disabled = false;
                    pauseSimulationButton.disabled = true;
                    resumeSimulationButton.disabled = true;
                    stepSimulationButton.disabled = true;
                    stopSimulationButton.disabled = true;
                }
                break;
        }
    });

}());
