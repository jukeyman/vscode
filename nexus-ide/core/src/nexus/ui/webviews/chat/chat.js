// Ensure this script runs in strict mode
(function () {
    'use strict';

    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const chatHistory = document.getElementById('chat-history');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    if (!chatHistory || !messageInput || !sendButton) {
        console.error("Chat UI elements not found!");
        return;
    }

    // Function to send message to the extension
    function sendMessage() {
        const messageText = messageInput.value.trim();
        if (messageText === '') {
            return;
        }

        // Check for /createfile command
        const createFileMatch = messageText.match(/^\/createfile\s+(\S+)\s+(.*)/s);
        if (createFileMatch) {
            const fileName = createFileMatch[1];
            const content = createFileMatch[2];
            vscode.postMessage({
                command: 'createFileRequest',
                data: { fileName, content }
            });
        } else {
            // Send as a regular message to the agent
            vscode.postMessage({
                command: 'sendMessageToAgent',
                text: messageText
            });
        }

        messageInput.value = ''; // Clear input field
    }

    sendButton.addEventListener('click', sendMessage);

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data; // The JSON data unserialized by VS Code

        switch (message.command) {
            case 'addChatMessage':
                const messageDiv = document.createElement('div');
                messageDiv.classList.add('message', message.sender); // e.g., 'message user', 'message agent'

                const senderSpan = document.createElement('span');
                senderSpan.classList.add('sender-label');
                senderSpan.textContent = message.sender.toUpperCase() + ": ";

                const textSpan = document.createElement('span');
                textSpan.textContent = message.text; // Text content is safer

                messageDiv.appendChild(senderSpan);
                messageDiv.appendChild(textSpan);

                chatHistory.appendChild(messageDiv);
                chatHistory.scrollTop = chatHistory.scrollHeight; // Scroll to the bottom
                break;
        }
    });

    // Inform the extension that the webview is ready
    vscode.postMessage({ command: 'webviewReady' });
    console.log("Chat webview JS loaded and ready message sent.");

}());
```
