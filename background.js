// background.js — NuMi Chrome Extension Service Worker

// ============================================================
// DYNAMIC SERVICE URL CONFIGURATION
// URLs are fetched from Firestore on install/startup and cached
// in chrome.storage.local. Falls back to production defaults.
// ============================================================
const DEFAULT_BACKEND_URL = 'https://numi-backend.up.railway.app';
const DEFAULT_SIGNUP_URL = 'https://numi-signup.vercel.app';
const DEFAULT_DASHBOARD_URL = 'https://numi-dashboard.vercel.app';

// Firebase REST API config for reading Firestore directly
const FIREBASE_PROJECT_ID = 'numi-userdata1';
const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/**
 * Fetches service config from Firestore REST API and caches it.
 * Falls back to hardcoded production defaults if fetch fails.
 */
async function syncServiceConfig() {
  try {
    const response = await fetch(`${FIRESTORE_REST_BASE}/numi-config/services`);
    if (response.ok) {
      const doc = await response.json();
      const fields = doc.fields || {};
      const config = {
        numi_backend_url: fields.backendUrl?.stringValue || DEFAULT_BACKEND_URL,
        numi_signup_url: fields.signupUrl?.stringValue || DEFAULT_SIGNUP_URL,
        numi_dashboard_url: fields.dashboardUrl?.stringValue || DEFAULT_DASHBOARD_URL
      };
      await chrome.storage.local.set(config);
      console.log('[NuMi] ✅ Service config synced from Firestore:', config);
      return config;
    }
  } catch (e) {
    console.warn('[NuMi] ⚠️ Could not fetch config from Firestore, using defaults:', e);
  }
  // Fallback: store defaults
  const defaults = {
    numi_backend_url: DEFAULT_BACKEND_URL,
    numi_signup_url: DEFAULT_SIGNUP_URL,
    numi_dashboard_url: DEFAULT_DASHBOARD_URL
  };
  await chrome.storage.local.set(defaults);
  return defaults;
}

/**
 * Returns cached service URLs from chrome.storage.local.
 * If not cached yet, triggers a sync first.
 */
function getServiceUrls() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['numi_backend_url', 'numi_signup_url', 'numi_dashboard_url'],
      (result) => {
        if (result.numi_backend_url) {
          resolve({
            backendUrl: result.numi_backend_url,
            signupUrl: result.numi_signup_url || DEFAULT_SIGNUP_URL,
            dashboardUrl: result.numi_dashboard_url || DEFAULT_DASHBOARD_URL
          });
        } else {
          // Not cached yet — sync and return
          syncServiceConfig().then((config) => {
            resolve({
              backendUrl: config.numi_backend_url,
              signupUrl: config.numi_signup_url,
              dashboardUrl: config.numi_dashboard_url
            });
          });
        }
      }
    );
  });
}

// Sync config on service worker startup
syncServiceConfig();

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
    Promise.all([getUserId(), getServiceUrls()]).then(([userId, urls]) => {
      const payload = { ...request.data, userId, mood: request.data?.mood || 'balanced' };
      fetch(`${urls.backendUrl}/save`, {
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
    Promise.all([getUserId(), getServiceUrls()]).then(([userId, urls]) => {
      const payload = { ...request.data, userId, mood: request.data?.mood || 'balanced' };
      fetch(`${urls.backendUrl}/chat`, {
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
    Promise.all([getUserId(), getServiceUrls()]).then(([userId, urls]) => {
      const payload = { ...(request.data || {}), userId, mood: request.data?.mood || 'balanced' };
      fetch(`${urls.backendUrl}/cuisines`, {
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

  // --- Get service URLs (used by content script / popup) ---
  if (request.action === "getServiceUrls") {
    getServiceUrls().then(urls => {
      sendResponse(urls);
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
  // Re-sync config on install/update
  syncServiceConfig();
  
  if (details.reason === 'install') {
    getServiceUrls().then(urls => {
      chrome.tabs.create({ url: `${urls.signupUrl}?ext=${chrome.runtime.id}` });
    });
  }
});