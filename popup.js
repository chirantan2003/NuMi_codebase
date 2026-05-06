// popup.js — NuMi Chrome Extension Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  const loadingState = document.getElementById('loading-state');
  const signupState = document.getElementById('signup-state');
  const profileState = document.getElementById('profile-state');
  const resetBtn = document.getElementById('reset-btn');

  // Fetch dynamic signup URL from background
  chrome.runtime.sendMessage({ action: 'getServiceUrls' }, (urls) => {
    const baseUrl = (urls && urls.signupUrl) || 'https://numi-signup.vercel.app';
    const signupUrl = baseUrl + "?ext=" + chrome.runtime.id;

    // Update all signup links in the popup to use dynamic URL
    const signupLinks = document.querySelectorAll('a[href*="numi-signup"], a[data-signup-link]');
    signupLinks.forEach(link => {
      link.href = signupUrl;
    });

    // Also set it on the signup-state button if it exists
    const signupBtn = signupState?.querySelector('a');
    if (signupBtn) {
      signupBtn.href = signupUrl;
    }
  });

  // Check if user is signed up
  chrome.storage.local.get(['numi_user_id', 'numi_user_name', 'numi_user_email'], (result) => {
    loadingState.style.display = 'none';

    if (result.numi_user_id) {
      // User is signed up — show profile
      profileState.style.display = 'flex';
      document.getElementById('profile-name').textContent = result.numi_user_name || '—';
      document.getElementById('profile-email').textContent = result.numi_user_email || '—';
      document.getElementById('profile-id').textContent = result.numi_user_id;
    } else {
      // User needs to sign up
      signupState.style.display = 'flex';
    }
  });

  // Reset profile
  resetBtn.addEventListener('click', () => {
    if (confirm('This will disconnect your NuMi profile. You can reconnect anytime from the signup page.')) {
      chrome.storage.local.remove(['numi_user_id', 'numi_user_name', 'numi_user_email'], () => {
        profileState.style.display = 'none';
        signupState.style.display = 'flex';
      });
    }
  });
});
