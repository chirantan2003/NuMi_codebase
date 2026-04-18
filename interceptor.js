// interceptor.js - Runs in the MAIN world (DoorDash only)
(function() {
  const originalFetch = window.fetch;
  
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      
      if (url.includes('graphql')) {
        const clone = response.clone();
        clone.json().then(data => {
          const dataString = JSON.stringify(data).toLowerCase();
          const currentUrl = window.location.href;
          
          // BRANCH 1: We are on a specific restaurant's menu page
          if (currentUrl.includes('/store/')) {
            if (dataString.includes('price') && (dataString.includes('description') || dataString.includes('items'))) {
              window.postMessage({ type: 'DD_MENU_INTERCEPTED', payload: data, url: currentUrl }, '*');
            }
          } 
          // BRANCH 2: We are on the main DoorDash homepage/feed
          else {
            // FIXED: Removed the overly strict 'rating' check. 
            // Now it looks for store/merchant info anywhere in the payloads.
            if (dataString.includes('name') && (dataString.includes('store') || dataString.includes('merchant'))) {
              window.postMessage({ type: 'DD_FEED_INTERCEPTED', payload: data, url: currentUrl }, '*');
            }
          }
        }).catch(() => {});
      }
    } catch (e) {}
    
    return response;
  };
})();