const UI_ID = "__food_recommender_panel";
let processedMenuCounts = new Map();
let currentRecommendations = null;

let feedStoresMap = new Map();
let feedAiTriggered = false;

// Debouncer variables to prevent double-firing
let interceptDebounceTimer = null;
let pendingPayloadToSend = null;

// Mood selector — persists across recommendation refreshes
let currentMood = 'balanced';
let lastTriggerType = null;  // 'cuisines' | 'menu_or_feed'
let lastPayload = null;      // cached payload for re-triggering on mood change
let moodRefreshTimer = null;

function createMoodSelector() {
  const moods = [
    { value: 'energetic', label: '☄️ Energetic' },
    { value: 'calm', label: '🌌 Calm' },
    { value: 'focussed', label: '💠 Focussed' },
    { value: 'de-stress', label: '🌀 De-Stress' },
    { value: 'balanced', label: '🫧 Balanced' }
  ];

  const bar = document.createElement('div');
  bar.className = 'numi-mood-bar';
  bar.style.cssText = `
    display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; flex-shrink: 0;
    scrollbar-width: none; -ms-overflow-style: none;
  `;

  moods.forEach(m => {
    const pill = document.createElement('button');
    pill.className = 'numi-mood-pill';
    pill.dataset.mood = m.value;
    const isActive = currentMood === m.value;
    pill.style.cssText = `
      flex-shrink: 0; padding: 8px 16px; border-radius: 20px;
      font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s ease;
      font-family: inherit; white-space: nowrap; display: flex; align-items: center; gap: 6px;
      background: #ffffff;
      color: #1a4049;
      border: 1px solid ${isActive ? '#1a4049' : '#e0e0e0'};
      box-shadow: ${isActive ? '0 0 0 1px #1a4049' : 'none'};
    `;
    pill.textContent = m.label;

    pill.addEventListener('click', () => {
      if (currentMood === m.value) return; // no change
      currentMood = m.value;
      // Update all pills in all mood bars on the page
      document.querySelectorAll('.numi-mood-pill').forEach(p => {
        const active = p.dataset.mood === m.value;
        p.style.border = active ? '1px solid #1a4049' : '1px solid #e0e0e0';
        p.style.boxShadow = active ? '0 0 0 1px #1a4049' : 'none';
      });
      // Debounce and re-trigger AI with new mood
      clearTimeout(moodRefreshTimer);
      moodRefreshTimer = setTimeout(() => refreshForMood(), 400);
    });

    bar.appendChild(pill);
  });

  return bar;
}

// --- userId check helper ---
function checkUserId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'checkUserId' }, (response) => {
      resolve(response?.userId || null);
    });
  });
}

// --- Signup Prompt UI (shown when user hasn't signed up) ---
function showSignupPrompt() {
  removeUI();
  // Fetch dynamic signup URL from background script
  chrome.runtime.sendMessage({ action: 'getServiceUrls' }, (urls) => {
    const signupUrl = (urls && urls.signupUrl) || 'https://numi-signup.vercel.app';
    const panel = document.createElement('div');
    panel.id = UI_ID;
    panel.style.cssText = `
      position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
      width: 340px; background: rgba(30, 30, 30, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      color: #fff; border-radius: 24px; padding: 24px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3); z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      border: 1px solid rgba(255,255,255,0.1); text-align: center;
    `;
    panel.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 8px;">🍽️</div>
      <div style="font-weight: 700; font-size: 16px; color: #fff; margin-bottom: 4px;">NuMi needs your profile</div>
      <div style="font-size: 12px; color: #aaa; margin-bottom: 16px; line-height: 1.4;">Create your NuMi profile to get personalized AI food recommendations here on DoorDash.</div>
      <a href="${signupUrl}" target="_blank" style="
        display: block; background: #506634; color: #fff; padding: 10px 20px; border-radius: 12px;
        font-weight: 700; font-size: 14px; text-decoration: none; transition: all 0.2s;
      ">Get Started →</a>
      <div id="__numi_dismiss" style="cursor: pointer; font-size: 11px; color: #666; margin-top: 10px; font-weight: 500;">Dismiss</div>
    `;
    document.body.appendChild(panel);
    document.getElementById('__numi_dismiss').addEventListener('click', removeUI);
  });
}

// --- Extension Icon Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleUI") {
    const panel = document.getElementById(UI_ID);
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    } else if (currentRecommendations) {
      injectRecommendationsUI(currentRecommendations);
    } else {
      alert("No AI recommendations available yet. Open a menu or the home feed to scan!");
    }
  }
});

// --- DoorDash Page Listener (With Debouncer) ---
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // BRANCH 1: HANDLE MENU DATA
  if (event.data.type === 'DD_MENU_INTERCEPTED') {
    feedAiTriggered = false;
    const restaurantId = (event.data.url || window.location.href).split('/store/')[1]?.split('/')[0] || "unknown";
    if (restaurantId === "unknown") return;

    const cleanMenu = normalizeMenu(event.data.payload, restaurantId);
    const prevCount = processedMenuCounts.get(restaurantId) || 0;

    if (cleanMenu && cleanMenu.items.length > prevCount) {
      processedMenuCounts.set(restaurantId, cleanMenu.items.length);

      pendingPayloadToSend = cleanMenu;
      clearTimeout(interceptDebounceTimer);
      interceptDebounceTimer = setTimeout(() => {
        console.log(`[Food Recommender] Menu settled! (${pendingPayloadToSend.items.length} items). Sending to AI...`);
        triggerBackend(pendingPayloadToSend);
      }, 1200);
    }
  }

  // BRANCH 2: HANDLE FEED DATA
  if (event.data.type === 'DD_FEED_INTERCEPTED') {
    const cleanFeed = normalizeFeed(event.data.payload);
    if (cleanFeed && cleanFeed.stores.length > 0) {
      cleanFeed.stores.forEach(store => feedStoresMap.set(store.name, store));

      if (feedStoresMap.size >= 5 && !feedAiTriggered) {
        pendingPayloadToSend = { dataType: 'feed', stores: Array.from(feedStoresMap.values()) };

        clearTimeout(interceptDebounceTimer);
        interceptDebounceTimer = setTimeout(() => {
          feedAiTriggered = true;
          console.log(`[Food Recommender] Feed settled! (${pendingPayloadToSend.stores.length} restaurants). Sending to AI...`);
          triggerBackend(pendingPayloadToSend);
        }, 1200);
      }
    }
  }
});

async function triggerBackend(dataPayload) {
  const userId = await checkUserId();
  if (!userId) {
    showSignupPrompt();
    return;
  }
  lastTriggerType = 'menu_or_feed';
  lastPayload = dataPayload;
  showLoadingUI();
  chrome.runtime.sendMessage(
    { action: "sendToLocalServer", data: { ...dataPayload, mood: currentMood } },
    (response) => {
      if (response && response.data) {
        currentRecommendations = response.data.recommended_items || response.data.recommended_restaurants;
        if (currentRecommendations) {
          injectRecommendationsUI(currentRecommendations, response.data.overall_advice, response.user_profile);
          return;
        }
      }
      removeUI();
      console.error("Failed to get recommendations", response);
    }
  );
}

// --- Re-trigger AI when mood changes ---
function refreshForMood() {
  console.log(`[NuMi] 🎭 Mood changed to "${currentMood}" — refreshing suggestions...`);
  if (lastTriggerType === 'menu_or_feed' && lastPayload) {
    showLoadingUI();
    chrome.runtime.sendMessage(
      { action: "sendToLocalServer", data: { ...lastPayload, mood: currentMood } },
      (response) => {
        if (response && response.data) {
          currentRecommendations = response.data.recommended_items || response.data.recommended_restaurants;
          if (currentRecommendations) {
            injectRecommendationsUI(currentRecommendations, response.data.overall_advice, response.user_profile);
            return;
          }
        }
        removeUI();
      }
    );
  } else if (lastTriggerType === 'cuisines') {
    showLoadingUI();
    chrome.runtime.sendMessage({ action: "getCuisines", data: { mood: currentMood } }, (response) => {
      if (response && response.data && response.data.recommended_cuisines) {
        const formattedCuisines = response.data.recommended_cuisines.map(c => ({
          restaurant_name: c.cuisine_name,
          explanation: c.explanation,
          isCuisine: true
        }));
        currentRecommendations = formattedCuisines;
        injectRecommendationsUI(formattedCuisines, response.data.overall_advice, response.user_profile);
      } else {
        removeUI();
      }
    });
  }
}

// --- DoorDash "Ghost Click" Logic (With Manual Scroll Cancel) ---
function findAndClickDoorDashItem(itemName) {
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let scrollAttempts = 0;
  const maxAttempts = 50;
  const scrollStep = window.innerHeight * 0.5;
  let userIntervened = false;

  const interventionHandler = (e) => {
    if (e.type === 'wheel' || e.type === 'touchmove') userIntervened = true;
    if (e.type === 'keydown' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Space', ' '].includes(e.key)) userIntervened = true;
  };

  window.addEventListener('wheel', interventionHandler, { passive: true });
  window.addEventListener('touchmove', interventionHandler, { passive: true });
  window.addEventListener('keydown', interventionHandler, { passive: true });

  const cleanupListeners = () => {
    window.removeEventListener('wheel', interventionHandler);
    window.removeEventListener('touchmove', interventionHandler);
    window.removeEventListener('keydown', interventionHandler);
  };

  setTimeout(() => {
    function searchAndScroll() {
      if (userIntervened) {
        console.log(`[Food Recommender] Auto-scroll canceled by user.`);
        cleanupListeners();
        return;
      }

      const elements = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el.closest(`#${UI_ID}`)) return false;
        return el.children.length === 0 && el.textContent.trim().toLowerCase() === itemName.toLowerCase();
      });

      if (elements.length > 0) {
        const targetEl = elements[0];
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
          const clickableCard = targetEl.closest('button, a, [role="button"], [cursor="pointer"], [data-anchor-id]') || targetEl;
          const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true, buttons: 1 });
          clickableCard.dispatchEvent(clickEvent);
        }, 850);
        cleanupListeners();
        return;
      }

      const isAtBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 10;
      if (isAtBottom || scrollAttempts >= maxAttempts) {
        alert(`Could not find "${itemName}". It might be hidden or further down the page.`);
        cleanupListeners();
        return;
      }

      window.scrollBy({ top: scrollStep, left: 0, behavior: 'smooth' });
      scrollAttempts++;
      setTimeout(searchAndScroll, 600);
    }
    searchAndScroll();
  }, 500);
}

// --- UI Logic (Reverted to the compact, unified design) ---
function showLoadingUI() {
  removeUI();
  const panel = document.createElement("div");
  panel.id = UI_ID;
  panel.style.cssText = `
    position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
    width: 420px; background: rgba(100, 130, 140, 0.4); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    color: #fff; border-radius: 24px; padding: 20px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.3); z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    border: 1px solid rgba(255,255,255,0.3); text-align: center;
    display: flex; flex-direction: column; gap: 12px;
  `;
  panel.innerHTML = `
    <div style="font-size: 20px; margin-bottom: 4px;">✨</div>
    <div style="font-weight: 600; font-size: 15px; color: #fff;">NuMi is analyzing...</div>
    <div style="font-size: 12px; color: #fff; opacity: 0.9; margin-top: 2px;">Pick your vibe while I find the perfect options</div>
  `;
  // Add mood selector to loading screen
  panel.appendChild(createMoodSelector());
  document.body.appendChild(panel);
}

function injectRecommendationsUI(recommendations, advice, profile) {
  removeUI();
  const panel = document.createElement("div");
  panel.id = UI_ID;

  panel.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    width: 90%; max-width: 700px; max-height: 90vh;
    background: rgba(100, 130, 140, 0.4); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-radius: 32px; padding: 24px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.3); z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; gap: 16px; transition: width 0.3s ease, padding 0.3s ease;
  `;

  const contextType = recommendations[0].item_name ? 'MENU' : 'RESTAURANT';

  const cardsHtml = recommendations.map((rec) => {
    const nameToDisplay = rec.item_name || rec.restaurant_name;

    // --- NEW: Conditionally render buttons only if it's NOT a cuisine ---
    const buttonsHtml = rec.isCuisine ? '' : `
        <div style="display: flex; gap: 8px;">
            <button class="nope-btn" style="flex: 1; background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 8px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;">Nope 👎</button>
            <button class="open-btn" style="flex: 1; background: #fff; color: #3b626e; border: none; padding: 8px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;">Open ↗</button>
        </div>
    `;

    // Added data-is-cuisine attribute so the click listener knows what to do
    // Store raw explanation in a data attribute for the hover popup
    const safeExplanation = rec.explanation.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `
      <div class="ai-food-card" data-name="${nameToDisplay}" data-is-cuisine="${!!rec.isCuisine}" data-explanation="${safeExplanation}" style="
        background: linear-gradient(135deg, #719b9f, #416870); color: #ffffff; border-radius: 16px; padding: 14px;
        min-width: 190px; width: 210px; flex-shrink: 0; position: relative;
        box-shadow: 0 6px 12px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;
        display: flex; flex-direction: column; justify-content: space-between;
      ">
        <div>
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; line-height: 1.2;">${nameToDisplay}</div>
            
            <div class="card-explanation" style="font-size: 12px; color: rgba(255,255,255,0.95); line-height: 1.4; margin-top: 8px; margin-bottom: 10px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;">
              ${rec.explanation}
            </div>
        </div>

        ${buttonsHtml}
      </div>
    `;
  }).join('');

  const isCuisineMode = !!recommendations[0].isCuisine;

  let prefsHtml = '';
  if (isCuisineMode && profile) {
      const prefs = [];
      const healthGoals = profile.health?.goals || [];
      const foodPrefs = profile.dietary?.foodPrefs || [];
      const allergies = profile.dietary?.allergies || [];
      const conditions = profile.dietary?.conditions || [];

      healthGoals.forEach(goal => prefs.push({ icon: chrome.runtime.getURL('public/health.png'), title: goal, subtitle: 'Health Goal' }));
      foodPrefs.forEach(pref => prefs.push({ icon: chrome.runtime.getURL('public/food%20preferences.png'), title: pref, subtitle: 'Food Preferences' }));
      allergies.forEach(allergy => prefs.push({ icon: chrome.runtime.getURL('public/specific%20diet.png'), title: allergy, subtitle: 'Specific Diets' }));
      conditions.forEach(cond => prefs.push({ icon: chrome.runtime.getURL('public/specific%20diet.png'), title: cond, subtitle: 'Specific Diets' }));
      
      // Fallback defaults if empty just to show
      if (prefs.length === 0) {
          prefs.push({ icon: chrome.runtime.getURL('public/health.png'), title: 'General Health', subtitle: 'Health Goals' });
          prefs.push({ icon: chrome.runtime.getURL('public/food%20preferences.png'), title: 'Omnivore', subtitle: 'Food Preferences' });
          prefs.push({ icon: chrome.runtime.getURL('public/specific%20diet.png'), title: 'None', subtitle: 'Specific Diets' });
      }

      prefsHtml = `
      <div class="numi-cards-slider" style="display: flex; gap: 16px; margin-top: 8px; overflow-x: auto; padding-bottom: 8px; flex-shrink: 0;">
          ${prefs.map(p => `
              <div style="background: #ffffff; border-radius: 24px; padding: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 140px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center; flex-shrink: 0;">
                  <img src="${p.icon}" style="width: 28px; height: 28px; object-fit: contain; margin-bottom: 8px;" />
                  <div style="font-weight: 700; font-size: 13px; color: #1a4049; margin-bottom: 2px;">${p.title}</div>
                  <div style="font-size: 11px; color: #888;">${p.subtitle}</div>
              </div>
          `).join('')}
      </div>`;
  }

  let adviceHtml = '';
  if (advice) {
      adviceHtml = `
          <div style="background: #ffffff; border-radius: 24px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); flex-shrink: 0;">
              <div style="font-size: 16px; font-weight: 700; color: #1a4049; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">✨ Advice</div>
              <div style="font-size: 14px; color: #555; line-height: 1.5;">${advice}</div>
          </div>
      `;
  } else {
      adviceHtml = `
          <div style="background: #ffffff; border-radius: 24px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); flex-shrink: 0;">
              <div style="font-size: 16px; font-weight: 700; color: #1a4049; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">✨ Advice</div>
              <div style="font-size: 14px; color: #555; line-height: 1.5;">Based on your profile, I have found the best options to maximize your goals while keeping you energetic.</div>
          </div>
      `;
  }

  panel.innerHTML = `
    <style>
        #chat_input::placeholder { color: #888; font-weight: 400; }
        .numi-cards-slider::-webkit-scrollbar { height: 8px; }
        .numi-cards-slider::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); border-radius: 8px; }
        .numi-cards-slider::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 8px; }
        .numi-cards-slider::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
        .numi-modal-backdrop {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            z-index: 1000000; display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.25s ease;
        }
        .numi-modal-backdrop.visible { opacity: 1; }
        .numi-modal-card {
            background: #ffffff;
            border-radius: 20px;
            padding: 28px 32px; max-width: 420px; width: 90%; max-height: 70vh; overflow-y: auto;
            color: #333; box-shadow: 0 24px 64px rgba(0,0,0,0.2);
            transform: scale(0.92); transition: transform 0.25s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .numi-modal-backdrop.visible .numi-modal-card { transform: scale(1); }
        .numi-modal-card::-webkit-scrollbar { width: 5px; }
        .numi-modal-card::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .numi-modal-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #1a4049; }
        .numi-modal-subtitle { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; margin-bottom: 10px; }
        .numi-modal-text { font-size: 14px; line-height: 1.6; color: #444; }
        .numi-modal-close {
            position: absolute; top: 14px; right: 18px; background: rgba(0,0,0,0.05); border: none;
            color: #1a4049; width: 28px; height: 28px; border-radius: 50%; font-size: 14px;
            cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;
        }
        .numi-modal-close:hover { background: rgba(0,0,0,0.1); }
    </style>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; padding: 0 4px;">
        <div style="color: #ffffff; font-family: Georgia, serif; font-weight: 700; font-size: 32px; display: flex; align-items: center; gap: 6px;">
            NuMI
        </div>
        <div style="display: flex; gap: 16px; align-items: center;">
            <div id="minimize_btn" style="cursor: pointer; color: #ffffff; font-weight: bold; font-size: 20px;">−</div>
            <div id="close_btn" style="cursor: pointer; color: #ffffff; font-weight: bold; font-size: 16px;">✖</div>
        </div>
    </div>

    <div id="numi_body" style="display: flex; flex-direction: column; gap: 16px; overflow-y: auto; scrollbar-width: none; padding-bottom: 4px;">
        
        ${prefsHtml}
        ${adviceHtml}

        <div style="background: white; border-radius: 24px; padding: 16px 20px; display: flex; flex-direction: column; box-shadow: 0 4px 16px rgba(0,0,0,0.05);">
            <div style="font-size: 20px; font-weight: 700; color: #1a4049; font-family: Georgia, serif;">How do you want to feel ?</div>
            
            <div id="numi_mood_slot" style="margin-top: 8px;"></div>

            <div style="font-size: 20px; font-weight: 700; color: #1a4049; font-family: Georgia, serif; margin-top: 6px;">Suggested ${isCuisineMode ? 'Cuisines' : 'Options'}</div>

            <div class="numi-cards-slider" style="display: flex; gap: 16px; overflow-x: auto; padding-top: 8px; padding-bottom: 4px; flex-shrink: 0;">
                ${cardsHtml}
            </div>
        </div>

        <div id="chat_history" style="display: none; background: #ffffff; border-radius: 20px; padding: 16px; max-height: 150px; overflow-y: auto; flex-direction: column; gap: 10px; flex-shrink: 0; box-shadow: inset 0 2px 8px rgba(0,0,0,0.02);"></div>
    </div>

    <div id="numi_chat_bar" style="display: flex; align-items: center; background: #ffffff; border-radius: 32px; padding: 4px 6px 4px 16px; gap: 12px; flex-shrink: 0; box-shadow: 0 4px 16px rgba(0,0,0,0.05); margin-top: 4px;">
        <div style="color: #1a4049; font-size: 20px;">✨</div>
        <input type="text" id="chat_input" placeholder="Chat about anything" style="background: transparent; border: none; color: #333; outline: none; flex: 1; font-size: 16px; font-family: inherit;">
        <button id="chat_send_btn" style="background: #fca34d; color: #fff; border: none; width: 34px; height: 34px; border-radius: 50%; font-weight: 600; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(252,163,77,0.3);">↑</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Inject mood selector into the slot
  const moodSlot = document.getElementById('numi_mood_slot');
  if (moodSlot) moodSlot.appendChild(createMoodSelector());

  // --- Header Controls Logic ---
  const bodyEl = document.getElementById('numi_body');
  const chatBarEl = document.getElementById('numi_chat_bar');
  const minBtn = document.getElementById('minimize_btn');

  function minimizeUI() {
    bodyEl.style.display = 'none';
    chatBarEl.style.display = 'none';
    minBtn.innerText = '−';
    panel.style.width = '300px';
    panel.style.padding = '12px 24px';
  }

  function maximizeUI() {
    bodyEl.style.display = 'flex';
    chatBarEl.style.display = 'flex';
    minBtn.innerText = '−';
    panel.style.width = '90%';
    panel.style.padding = '24px';
  }

  document.getElementById('close_btn').addEventListener('click', removeUI);
  minBtn.addEventListener('click', () => {
    if (bodyEl.style.display === 'none') maximizeUI();
    else minimizeUI();
  });

  // --- Card Action Logic ---
  // --- Centered modal helper ---
  function showExplanationModal(name, explanation) {
    // Remove any existing modal
    const old = document.querySelector('.numi-modal-backdrop');
    if (old) old.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'numi-modal-backdrop';
    backdrop.innerHTML = `
      <div class="numi-modal-card" style="position: relative;">
        <button class="numi-modal-close">✕</button>
        <div class="numi-modal-title">${name}</div>
        <div class="numi-modal-subtitle">Why this choice?</div>
        <div class="numi-modal-text">${explanation}</div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // Fade in
    requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('visible')));

    // Close handlers
    const dismiss = () => {
      backdrop.classList.remove('visible');
      setTimeout(() => backdrop.remove(), 250);
    };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) dismiss(); });
    backdrop.querySelector('.numi-modal-close').addEventListener('click', dismiss);
  }

  document.querySelectorAll('.ai-food-card').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.transform = 'translateY(-6px)');
    el.addEventListener('mouseleave', () => el.style.transform = 'translateY(0)');

    el.addEventListener('click', (e) => {
      const isCuisine = e.currentTarget.getAttribute('data-is-cuisine') === 'true';
      const clickedExplanation = e.target.closest('.card-explanation') || e.target.closest('[style*="Why this choice"]');

      // Show modal if it's a cuisine card or if user clicked the explanation text
      if (isCuisine || clickedExplanation) {
        const name = e.currentTarget.getAttribute('data-name');
        const explanation = e.currentTarget.getAttribute('data-explanation');
        if (explanation) showExplanationModal(name, explanation);
        return;
      }

      if (e.target.classList.contains('nope-btn')) {
        el.style.display = 'none';
        return;
      }

      const itemName = e.currentTarget.getAttribute('data-name');
      minimizeUI();
      if (typeof findAndClickDoorDashItem === 'function') {
        findAndClickDoorDashItem(itemName);
      }
    });
  });

  // --- Chat Logic ---
  const chatInput = document.getElementById('chat_input');
  const chatSendBtn = document.getElementById('chat_send_btn');
  const chatHistory = document.getElementById('chat_history');

  // Prevent DoorDash from intercepting keyboard events on our input
  ['keydown', 'keyup', 'keypress', 'input'].forEach(evtType => {
    chatInput.addEventListener(evtType, (e) => e.stopPropagation());
  });

  function handleChatSend() {
    const msg = chatInput.value.trim();
    if (!msg) return;

    chatHistory.style.display = 'flex';
    appendChatMessage('You', msg, '#333', '#f0f0f0');
    chatInput.value = '';

    const loadingId = appendChatMessage('NuMi', 'Thinking...', '#888', 'transparent');
    setTimeout(() => bodyEl.scrollTop = bodyEl.scrollHeight, 50);

    console.log('[NuMi Chat] Sending:', { message: msg, contextType: contextType.toLowerCase(), mood: currentMood });

    chrome.runtime.sendMessage(
      { action: "sendChatMessage", data: { message: msg, contextType: contextType.toLowerCase(), mood: currentMood } },
      (response) => {
        console.log('[NuMi Chat] Response:', response);
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (chrome.runtime.lastError) {
          console.error('[NuMi Chat] Runtime error:', chrome.runtime.lastError);
          appendChatMessage('Error', 'Extension connection lost. Try reloading.', '#ff4444', 'transparent');
        } else if (response && response.reply) {
          appendChatMessage('NuMi', response.reply, '#1a4049', 'rgba(26,64,73,0.1)');
        } else if (response && response.error) {
          appendChatMessage('Error', response.error, '#ff4444', 'transparent');
        } else {
          appendChatMessage('Error', 'Failed to reach AI.', '#ff4444', 'transparent');
        }
        setTimeout(() => bodyEl.scrollTop = bodyEl.scrollHeight, 50);
      }
    );
  }

  chatSendBtn.addEventListener('click', handleChatSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
  });
}

function appendChatMessage(sender, text, textColor, bgColor) {
  const history = document.getElementById('chat_history');
  const div = document.createElement('div');
  const uniqueId = 'msg_' + Date.now();
  div.id = uniqueId;
  div.style.cssText = `background: ${bgColor}; padding: 10px 14px; border-radius: 12px; line-height: 1.4; font-size: 14px; color: ${textColor}; align-self: ${sender === 'You' ? 'flex-end' : 'flex-start'}; max-width: 85%;`;

  const prefix = sender === 'NuMi' ? `<strong style="color: #1a4049;">✨ NuMi:</strong> ` : '';
  div.innerHTML = `${prefix}<span>${text}</span>`;

  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
  return uniqueId;
}

function removeUI() {
  const existing = document.getElementById(UI_ID);
  if (existing) existing.remove();
}

// --- Normalization functions ---
function normalizeFeed(rawJson) {
  const stores = [];
  const seenStores = new Set();
  function dig(obj) {
    if (!obj || typeof obj !== 'object') return;
    const isStore = obj.name && typeof obj.name === 'string' && (obj.averageRating !== undefined || obj.storeUrl !== undefined || obj.storefrontId !== undefined || obj.businessId !== undefined);
    if (isStore) {
      const name = obj.name.trim();
      if (name.length > 0 && name.length < 60 && !seenStores.has(name)) {
        seenStores.add(name);
        stores.push({ name: name, rating: obj.averageRating || "N/A", tags: obj.description || "N/A" });
      }
    }
    Object.values(obj).forEach(val => {
      if (Array.isArray(val)) val.forEach(item => dig(item));
      else if (typeof val === 'object') dig(val);
    });
  }
  dig(rawJson);
  return { dataType: 'feed', stores: stores };
}

function normalizeMenu(rawJson, restaurantId) {
  const items = [];
  const seenNames = new Set();
  function dig(obj) {
    if (!obj || typeof obj !== 'object') return;
    const hasName = typeof obj.name === 'string';
    const hasPrice = obj.price != null || obj.displayPrice != null;
    const isNotModifier = !obj.minChoiceOptions;
    if (hasName && hasPrice && isNotModifier) {
      const name = obj.name.trim();
      if (name.length > 0 && !seenNames.has(name)) {
        let formattedPrice = obj.displayPrice || obj.price;
        if (typeof formattedPrice === 'number' && formattedPrice > 100) formattedPrice = "$" + (formattedPrice / 100).toFixed(2);
        seenNames.add(name);
        items.push({ name: name, description: obj.description ? obj.description.trim() : "", price: formattedPrice });
      }
    }
    Object.values(obj).forEach(value => {
      if (Array.isArray(value)) value.forEach(item => dig(item));
      else if (typeof value === 'object') dig(value);
    });
  }
  dig(rawJson);
  return { restaurantId: restaurantId, items: items };
}

// --- Initial Homepage Cuisine Trigger (BULLETPROOF VERSION) ---
async function triggerInitialCuisines() {
  const path = window.location.pathname;
  const isHomePage = path === '/' || path.startsWith('/home') || path.startsWith('/en-US');

  console.log(`🍔 [NuMi] Checking if homepage... Path is: ${path} | isHomePage: ${isHomePage}`);

  if (isHomePage) {
    console.log("🍔 [NuMi] Homepage confirmed! Requesting cuisines...");

    // Make sure the body actually exists before we try to draw the UI
    if (!document.body) {
      console.log("🍔 [NuMi] Page not fully loaded yet, trying again in 500ms...");
      setTimeout(triggerInitialCuisines, 500);
      return;
    }

    // Check if user is signed up before calling the backend
    const userId = await checkUserId();
    if (!userId) {
      showSignupPrompt();
      return;
    }

    lastTriggerType = 'cuisines';
    showLoadingUI();

    chrome.runtime.sendMessage({ action: "getCuisines", data: { mood: currentMood } }, (response) => {
      console.log("🍔 [NuMi] Background script responded with:", response);

      if (response && response.data && response.data.recommended_cuisines) {
        console.log("🍔 [NuMi] Success! Drawing cuisines on screen.");
        const formattedCuisines = response.data.recommended_cuisines.map(c => ({
          restaurant_name: c.cuisine_name,
          explanation: c.explanation,
          isCuisine: true
        }));
        currentRecommendations = formattedCuisines;
        injectRecommendationsUI(formattedCuisines, response.data.overall_advice, response.user_profile);
      } else {
        removeUI();
        console.error("🍔 [NuMi] Failed or empty response from Python server.");
      }
    });
  }
}

// Wait until the page is actually ready, then fire.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", triggerInitialCuisines);
} else {
  // Give DoorDash's React framework 1.5s to mount
  setTimeout(triggerInitialCuisines, 1500);
}