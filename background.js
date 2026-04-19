// background.js — NuMi Chrome Extension Service Worker

// const BACKEND_URL = 'https://numi-backend.up.railway.app';
const BACKEND_URL = 'http://localhost:5001';

// For local testing, use localhost. For production, use the Vercel URL.
// const SIGNUP_URL = 'https://numi-signup.vercel.app';
const SIGNUP_URL = 'http://localhost:3000';

// ============================================================
// HELPER: Get userId from chrome.storage before making requests
// ============================================================
function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['numi_user_id'], (result) => {
      resolve(result.numi_user_id || null);
    });
  });
}

// ============================================================
// MESSAGE LISTENERS — Content script → Background → Backend
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // --- Scraping payload (menu or feed data) ---
  if (request.action === "sendToLocalServer") {
    getUserId().then(userId => {
      const payload = { ...request.data, userId, mood: request.data?.mood || 'balanced' };
      fetch(`${BACKEND_URL}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(error => {
          console.error('[NuMi BG] Server error:', error);
          sendResponse({ error: "Failed to connect to NuMi server" });
        });
    });
    return true;
  }

  // --- Chat messages ---
  if (request.action === "sendChatMessage") {
    getUserId().then(userId => {
      const payload = { ...request.data, userId, mood: request.data?.mood || 'balanced' };
      fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(error => {
          console.error('[NuMi BG] Chat error:', error);
          sendResponse({ error: "Failed to reach chat server" });
        });
    });
    return true;
  }

  // --- Initial cuisine recommendations ---
  if (request.action === "getCuisines") {
    getUserId().then(userId => {
      const payload = { ...(request.data || {}), userId, mood: request.data?.mood || 'balanced' };
      fetch(`${BACKEND_URL}/cuisines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(error => {
          console.error('[NuMi BG] Cuisine error:', error);
          sendResponse({ error: "Failed to reach cuisine server" });
        });
    });
    return true;
  }

  // --- Check if user is signed up (used by content script) ---
  if (request.action === "checkUserId") {
    getUserId().then(userId => {
      sendResponse({ userId });
    });
    return true;
  }
});

// ============================================================
// EXTERNAL MESSAGE LISTENER — Signup web app → Extension
// The signup app sends the userId after profile creation
// ============================================================
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.action === 'setUserId') {
    chrome.storage.local.set({
      numi_user_id: request.userId,
      numi_user_name: request.userName || '',
      numi_user_email: request.userEmail || ''
    }, () => {
      console.log('[NuMi] ✅ User synced from signup app:', request.userId);
      sendResponse({ success: true });
    });
    return true;
  }
});

// ============================================================
// EXTENSION ICON CLICK — Toggle UI (fallback if popup is disabled)
// ============================================================
// NOTE: With default_popup set, this won't fire. Left here for
// potential programmatic toggling via chrome.action.setPopup({popup: ''})
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
});

// ============================================================
// ON INSTALL — Open signup page for first-time users
// ============================================================
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: `${SIGNUP_URL}?ext=${chrome.runtime.id}` });
  }
});