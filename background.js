chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Original listener for the scraping payload
    if (request.action === "sendToLocalServer") {
        fetch('http://127.0.0.1:5000/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.data)
        })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(error => sendResponse({ error: "Failed to connect to server" }));
        return true; 
    }

    // NEW: Listener specifically for chat messages
    if (request.action === "sendChatMessage") {
        fetch('http://127.0.0.1:5000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.data)
        })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(error => sendResponse({ error: "Failed to reach chat server" }));
        return true; 
    }
});

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
});