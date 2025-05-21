// Ensure this script runs in strict mode
(function () {
    'use strict';

    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const promptSelector = document.getElementById('promptSelector');
    const promptContext = document.getElementById('promptContext');
    const sendPromptButton = document.getElementById('sendPromptButton');
    const responseArea = document.getElementById('responseArea');

    sendPromptButton.addEventListener('click', () => {
        const selectedPrompt = promptSelector.value;
        const contextValue = promptContext.value;
        
        responseArea.textContent = 'Sending prompt...'; // Provide immediate feedback

        vscode.postMessage({
            command: 'sendPrompt',
            promptName: selectedPrompt,
            context: contextValue
        });
    });

    window.addEventListener('message', event => {
        const message = event.data; // The JSON data unserialized by VS Code
        switch (message.command) {
            case 'llmResponse':
                if (responseArea) {
                    responseArea.textContent = message.response;
                }
                break;
            case 'error':
                if (responseArea) {
                    responseArea.textContent = `Error: ${message.text}`;
                }
                // Consider showing a VS Code native error message as well, if appropriate
                // vscode.window.showErrorMessage(message.text); // This would need to be sent from extension
                break;
            // Add more cases as needed for other commands from the extension
        }
    });

}());
