const UI_ID = "__food_recommender_panel";
let processedMenuCounts = new Map(); 
let currentRecommendations = null;

let feedStoresMap = new Map(); 
let feedAiTriggered = false;

// Debouncer variables to prevent double-firing
let interceptDebounceTimer = null;
let pendingPayloadToSend = null;

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

function triggerBackend(dataPayload) {
  showLoadingUI(); 
  chrome.runtime.sendMessage(
    { action: "sendToLocalServer", data: dataPayload },
    (response) => {
        if (response && response.data) {
            currentRecommendations = response.data.recommended_items || response.data.recommended_restaurants;
            if (currentRecommendations) {
                injectRecommendationsUI(currentRecommendations);
                return;
            }
        }
        removeUI();
        console.error("Failed to get recommendations", response);
    }
  );
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
    width: 320px; background: rgba(30, 30, 30, 0.6); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    color: #fff; border-radius: 24px; padding: 20px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.3); z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    border: 1px solid rgba(255,255,255,0.1); text-align: center;
  `;
  panel.innerHTML = `
    <div style="font-size: 20px; margin-bottom: 8px;">✨</div>
    <div style="font-weight: 600; font-size: 15px; color: #fff;">NuMi is analyzing...</div>
    <div style="font-size: 12px; color: #aaa; margin-top: 4px;">Finding the perfect options</div>
  `;
  document.body.appendChild(panel);
}

function injectRecommendationsUI(recommendations) {
  removeUI();
  const panel = document.createElement("div");
  panel.id = UI_ID;
  
  panel.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    width: 90%; max-width: 800px; max-height: 85vh;
    background: rgba(80, 75, 60, 0.4); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border-radius: 28px; padding: 16px 20px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.4); z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    border: 1px solid rgba(255,255,255,0.2);
    display: flex; flex-direction: column; gap: 12px; transition: all 0.3s ease;
  `;

  const contextType = recommendations[0].item_name ? 'MENU' : 'RESTAURANT';

  const cardsHtml = recommendations.map((rec) => {
    const nameToDisplay = rec.item_name || rec.restaurant_name;
    return `
      <div class="ai-food-card" data-name="${nameToDisplay}" style="
        background: #ffffff; color: #333; border-radius: 20px; padding: 16px;
        min-width: 260px; width: 280px; flex-shrink: 0; position: relative;
        box-shadow: 0 8px 16px rgba(0,0,0,0.08); cursor: pointer; transition: transform 0.2s;
        display: flex; flex-direction: column; justify-content: space-between;
      ">
        <div>
            <div style="font-size: 16px; font-weight: 700; margin-bottom: 2px; line-height: 1.2;">${nameToDisplay}</div>
            <div style="font-size: 11px; color: #777; margin-bottom: 12px;">Highly Recommended</div>
            
            <div style="font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; margin-bottom: 4px;">Why this choice?</div>
            <div style="font-size: 12px; color: #444; line-height: 1.4; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;">
              ${rec.explanation}
            </div>
        </div>

        <div style="display: flex; gap: 8px;">
            <button class="nope-btn" style="flex: 1; background: #f0f0f0; color: #555; border: none; padding: 8px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;">Nope 👎</button>
            <button class="open-btn" style="flex: 1; background: #2b2bff; color: #fff; border: none; padding: 8px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;">Open ↗</button>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <style>
        #chat_input::placeholder { color: #ffffff; opacity: 0.9; }
        .numi-cards-slider::-webkit-scrollbar { height: 8px; }
        .numi-cards-slider::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 8px; }
        .numi-cards-slider::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.4); border-radius: 8px; }
        .numi-cards-slider::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.6); }
    </style>

    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 4px;">
        <div style="color: #fff; font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px;">
            <span style="background: #fff; border-radius: 4px; padding: 2px 6px; color: #b38f00; font-size: 11px;">★</span>
            NuMi
        </div>
        <div style="display: flex; gap: 8px;">
            <div id="minimize_btn" style="cursor: pointer; background: rgba(0,0,0,0.3); color: #fff; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; transition: 0.2s;">−</div>
            <div id="close_btn" style="cursor: pointer; background: #ff4444; color: #fff; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; transition: 0.2s;">✖</div>
        </div>
    </div>

    <div id="numi_body" style="display: flex; flex-direction: column; gap: 12px; overflow-y: auto; scrollbar-width: none; padding-bottom: 4px;">
        
        <div style="background: rgba(255,255,255,0.9); border-radius: 16px; padding: 12px 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); flex-shrink: 0;">
            <div style="font-size: 11px; font-weight: 800; color: #333; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">✨ ADVICE</div>
            <div style="font-size: 13px; color: #444; line-height: 1.4;">Based on your profile, these options maximize your goals while keeping you energetic. I've prioritized meals that align perfectly with your preferences.</div>
        </div>

        <div class="numi-cards-slider" style="display: flex; gap: 12px; overflow-x: auto; padding-top: 6px; padding-bottom: 12px; flex-shrink: 0;">
            ${cardsHtml}
        </div>

        <div id="chat_history" style="display: none; background: rgba(0,0,0,0.2); border-radius: 16px; padding: 12px; max-height: 120px; overflow-y: auto; flex-direction: column; gap: 8px; flex-shrink: 0;"></div>
    </div>

    <div id="numi_chat_bar" style="display: flex; align-items: center; background: rgba(0,0,0,0.4); border-radius: 30px; padding: 6px 6px 6px 14px; gap: 10px; flex-shrink: 0;">
        <div style="background: #a38c22; color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px;">🐥</div>
        <input type="text" id="chat_input" placeholder="✨ Chat about Anything" style="background: transparent; border: none; color: #fff; outline: none; flex: 1; font-size: 14px; font-family: inherit;">
        <button id="chat_send_btn" style="background: #8b7315; color: #fff; border: none; padding: 8px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px;">Suggest 💬</button>
    </div>
  `;

  document.body.appendChild(panel);

  // --- Header Controls Logic ---
  const bodyEl = document.getElementById('numi_body');
  const chatBarEl = document.getElementById('numi_chat_bar');
  const minBtn = document.getElementById('minimize_btn');

  function minimizeUI() {
      bodyEl.style.display = 'none';
      chatBarEl.style.display = 'none';
      minBtn.innerText = '−';
      panel.style.width = '300px'; 
  }

  function maximizeUI() {
      bodyEl.style.display = 'flex';
      chatBarEl.style.display = 'flex';
      minBtn.innerText = '−';
      panel.style.width = '90%'; 
  }

  document.getElementById('close_btn').addEventListener('click', removeUI);
  minBtn.addEventListener('click', () => {
      if (bodyEl.style.display === 'none') maximizeUI();
      else minimizeUI();
  });

  // --- Card Action Logic ---
  document.querySelectorAll('.ai-food-card').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.transform = 'translateY(-6px)');
    el.addEventListener('mouseleave', () => el.style.transform = 'translateY(0)');
    
    el.addEventListener('click', (e) => {
      if(e.target.classList.contains('nope-btn')) {
          el.style.display = 'none';
          return;
      }
      
      const itemName = e.currentTarget.getAttribute('data-name');
      minimizeUI(); 
      findAndClickDoorDashItem(itemName); 
    });
  });

  // --- Chat Logic ---
  const chatInput = document.getElementById('chat_input');
  const chatSendBtn = document.getElementById('chat_send_btn');
  const chatHistory = document.getElementById('chat_history');

  function handleChatSend() {
      const msg = chatInput.value.trim();
      if (!msg) return;

      chatHistory.style.display = 'flex'; 
      appendChatMessage('You', msg, '#ffffff', 'rgba(255,255,255,0.1)');
      chatInput.value = '';

      const loadingId = appendChatMessage('NuMi', 'Thinking...', '#aaaaaa', 'transparent');
      setTimeout(() => bodyEl.scrollTop = bodyEl.scrollHeight, 50);

      chrome.runtime.sendMessage(
          { action: "sendChatMessage", data: { message: msg, contextType: contextType.toLowerCase() } },
          (response) => {
              const loadingEl = document.getElementById(loadingId);
              if (loadingEl) loadingEl.remove();

              if (response && response.reply) {
                  appendChatMessage('NuMi', response.reply, '#fff', 'rgba(43, 43, 255, 0.2)');
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
    div.style.cssText = `background: ${bgColor}; padding: 10px 14px; border-radius: 12px; line-height: 1.4; font-size: 13px; color: ${textColor}; align-self: ${sender === 'You' ? 'flex-end' : 'flex-start'}; max-width: 85%;`;
    
    const prefix = sender === 'NuMi' ? `<strong style="color: #00E676;">✨ NuMi:</strong> ` : '';
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