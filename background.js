chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendToLocalServer") {
        
        fetch('http://127.0.0.1:5000/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.data)
        })
        .then(response => response.json())
        .then(data => {
            // Send the Python server's response back to content.js
            sendResponse(data); 
        })
        .catch(error => {
            console.error("Fetch error:", error);
            sendResponse({ error: "Failed to connect to server" });
        });

        chrome.action.onClicked.addListener((tab) => {
            // Send a message to the active tab to toggle the UI
            chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
        });
        
        // IMPORTANT: Tells Chrome to keep the message channel open for the async response
        return true; 
    }
});