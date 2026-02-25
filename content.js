const UI_ID = "__food_recommender_panel";
let processedMenuCounts = new Map(); 
let currentRecommendations = null;

// Accumulator variables for the homepage feed
let feedStoresMap = new Map(); 
let feedAiTriggered = false;

// --- Extension Icon Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleUI") {
        const panel = document.getElementById(UI_ID);
        
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        } else if (currentRecommendations) {
            injectRecommendationsUI(currentRecommendations);
        } else {
            alert("No AI recommendations available yet. Open a menu or the home feed to scan!");
        }
    }
});

// --- DoorDash Page Listener ---
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // BRANCH 1: HANDLE MENU DATA
  if (event.data.type === 'DD_MENU_INTERCEPTED') {
    feedAiTriggered = false; // Reset feed trigger if we navigate to a menu
    
    const restaurantId = (event.data.url || window.location.href).split('/store/')[1]?.split('/')[0] || "unknown";
    if (restaurantId === "unknown") return;

    const cleanMenu = normalizeMenu(event.data.payload, restaurantId);
    if (cleanMenu && cleanMenu.items.length > (processedMenuCounts.get(restaurantId) || 0) + 5) {
        processedMenuCounts.set(restaurantId, cleanMenu.items.length);
        console.log(`[Food Recommender] Intercepted richer menu! (${cleanMenu.items.length} items). Sending to AI...`);
        triggerBackend(cleanMenu);
    }
  }

  // BRANCH 2: HANDLE FEED DATA
  if (event.data.type === 'DD_FEED_INTERCEPTED') {
    const cleanFeed = normalizeFeed(event.data.payload);
    
    if (cleanFeed && cleanFeed.stores.length > 0) {
        // Accumulate unique restaurants
        cleanFeed.stores.forEach(store => {
            if (!feedStoresMap.has(store.name)) {
                feedStoresMap.set(store.name, store);
            }
        });

        // Trigger AI only once, after we've gathered at least 5 restaurants
        if (feedStoresMap.size >= 5 && !feedAiTriggered) {
            feedAiTriggered = true;
            console.log(`[Food Recommender] Gathered ${feedStoresMap.size} unique restaurants from feed. Sending to AI...`);
            
            const payloadToSend = {
                dataType: 'feed',
                stores: Array.from(feedStoresMap.values())
            };
            
            triggerBackend(payloadToSend);
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

// --- DoorDash "Ghost Click" Logic (Smooth Scrolling Method) ---
function findAndClickDoorDashItem(itemName) {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  let scrollAttempts = 0;
  const maxAttempts = 50; 
  const scrollStep = window.innerHeight * 0.5; 

  setTimeout(() => {
      function searchAndScroll() {
        const elements = Array.from(document.querySelectorAll('*')).filter(el => {
          return el.children.length === 0 && el.textContent.trim().toLowerCase() === itemName.toLowerCase();
        });

        if (elements.length > 0) {
          const targetEl = elements[0];
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

          setTimeout(() => {
            const clickableCard = targetEl.closest('button, a, [role="button"], [cursor="pointer"], [data-anchor-id]') || targetEl;
            
            const clickEvent = new MouseEvent('click', {
                view: window, bubbles: true, cancelable: true, buttons: 1
            });
            clickableCard.dispatchEvent(clickEvent);
          }, 850); 
          
          return; 
        }

        const isAtBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 10;
        if (isAtBottom || scrollAttempts >= maxAttempts) {
            alert(`Could not find "${itemName}". It might be hidden, out of stock, or further down the page.`);
            return; 
        }

        window.scrollBy({ top: scrollStep, left: 0, behavior: 'smooth' });
        scrollAttempts++;
        setTimeout(searchAndScroll, 600); 
      }
      searchAndScroll();
  }, 500); 
}

// --- UI Injection Logic ---
function showLoadingUI() {
  removeUI();
  const panel = document.createElement("div");
  panel.id = UI_ID;
  panel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; width: 340px;
    background: #1e1e1e; color: #fff; border-radius: 8px; padding: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,.8); z-index: 999999;
    font-family: sans-serif; border: 2px solid #ff9800;
  `;
  panel.innerHTML = `<div style="text-align:center; font-weight:bold; color:#ff9800;">NuMi is analyzing...</div>`;
  document.body.appendChild(panel);
}

function injectRecommendationsUI(recommendations) {
  removeUI();
  const panel = document.createElement("div");
  panel.id = UI_ID;
  panel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; width: 360px;
    background: #1e1e1e; color: #fff; border-radius: 8px; padding: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,.8); z-index: 999999;
    font-family: sans-serif; border: 2px solid #00E676;
    transition: height 0.3s ease;
  `;

  // The nameToDisplay logic is now safely inside the map function!
  const linksHtml = recommendations.map(rec => {
    const nameToDisplay = rec.item_name || rec.restaurant_name;
    return `
      <div class="ai-food-link" data-name="${nameToDisplay}" style="background: #2a2a2a; padding: 10px; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: 0.2s;">
        <div style="color: #00E676; font-weight: bold; font-size: 14px; margin-bottom: 4px;">🎯 ${nameToDisplay}</div>
        <div style="color: #bbb; font-size: 12px; line-height: 1.4;">${rec.explanation}</div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <strong style="color:#00E676;">Top Picks For You</strong>
      <div>
        <span id="minimize_scraper_btn" style="cursor:pointer; color:#fff; font-size:16px; font-weight:bold; margin-right: 12px;" title="Minimize">−</span>
        <span id="close_scraper_x" style="cursor:pointer; color:#ff5252; font-size:16px; font-weight:bold;" title="Close">✖</span>
      </div>
    </div>
    <div id="ai_recommendations_list" style="max-height: 400px; overflow-y: auto; display: block;">
      ${linksHtml}
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById('close_scraper_x').addEventListener('click', removeUI);
  
  document.getElementById('minimize_scraper_btn').addEventListener('click', () => {
      const list = document.getElementById('ai_recommendations_list');
      if (list.style.display === 'none') {
          list.style.display = 'block';
          document.getElementById('minimize_scraper_btn').innerText = '−';
      } else {
          list.style.display = 'none';
          document.getElementById('minimize_scraper_btn').innerText = '□';
      }
  });

  document.querySelectorAll('.ai-food-link').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = '#3a3a3a');
    el.addEventListener('mouseleave', () => el.style.background = '#2a2a2a');
    el.addEventListener('click', (e) => {
      const itemName = e.currentTarget.getAttribute('data-name');
      findAndClickDoorDashItem(itemName); 
    });
  });
}

function removeUI() {
  const existing = document.getElementById(UI_ID);
  if (existing) existing.remove();
}

// --- Feed Normalization ---
function normalizeFeed(rawJson) {
  const stores = [];
  const seenStores = new Set();
  
  function dig(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Robust DoorDash Feed Heuristic
    const isStore = obj.name && (obj.averageRating !== undefined || obj.storeUrl || obj.storefrontId || obj.businessId);
    
    if (isStore && typeof obj.name === 'string') {
      const name = obj.name.trim();
      if (name.length > 0 && name.length < 60 && !seenStores.has(name)) {
        seenStores.add(name);
        stores.push({
            name: name,
            rating: obj.averageRating || "N/A",
            tags: obj.description || "N/A"
        });
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

// --- Menu Normalization ---
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
        if (typeof formattedPrice === 'number' && formattedPrice > 100) {
            formattedPrice = "$" + (formattedPrice / 100).toFixed(2);
        }
        seenNames.add(name);
        items.push({
          name: name,
          description: obj.description ? obj.description.trim() : "",
          price: formattedPrice
        });
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