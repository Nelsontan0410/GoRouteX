// Authentication module for BJS Delivery App

// Check if user is authenticated
function checkAuthentication() {
  const isLoggedIn = localStorage.getItem('bjsLoggedIn') === 'true';
  const loginTime = localStorage.getItem('bjsLoginTime');
  
  // Check if login has expired (24 hours)
  let loginExpired = false;
  if (loginTime) {
    const loginDate = new Date(loginTime);
    const currentDate = new Date();
    const hoursDiff = (currentDate - loginDate) / (1000 * 60 * 60);
    loginExpired = hoursDiff > 24;
  }
  
  if ((!isLoggedIn || loginExpired) && !window.location.pathname.includes('login.html')) {
    // Redirect to login page if not on it
    window.location.href = 'login.html';
    
    // Clear expired login if needed
    if (loginExpired) {
      localStorage.removeItem('bjsLoggedIn');
      localStorage.removeItem('bjsUsername');
      localStorage.removeItem('bjsLoginTime');
    }
    return false;

  } else if (isLoggedIn) {
    // Ensure any previous welcome banner is removed
    const banner = document.getElementById('auth-container');
    if (banner) banner.remove();
    return true;
  }
}

// Logout function
function logout() {
  localStorage.removeItem('bjsLoggedIn');
  localStorage.removeItem('bjsUsername');
  localStorage.removeItem('bjsLoginTime');
  window.location.href = 'login.html';
}

// === Restore original per-page logout button logic ===
function manageLogoutButton() {
  const logoutBtn = document.getElementById('logoutBtn');
  const activePage = document.querySelector('.page.active-page');
  const isOnFirstPage = activePage && activePage.id === 'page-select-stops';
  
  if (isOnFirstPage && !logoutBtn && localStorage.getItem('bjsLoggedIn') === 'true') {
    const newLogoutBtn = document.createElement('button');
    newLogoutBtn.id = 'logoutBtn';
    newLogoutBtn.textContent = 'Logout';
    newLogoutBtn.className = 'action-button-secondary';
    newLogoutBtn.style.position = 'fixed';
    newLogoutBtn.style.top = '10px';
    newLogoutBtn.style.right = '10px';
    newLogoutBtn.style.zIndex = '1000';
    newLogoutBtn.style.padding = '5px 10px';
    newLogoutBtn.style.fontSize = '0.8rem';
    newLogoutBtn.addEventListener('click', logout);
    document.body.appendChild(newLogoutBtn);
  } else if (!isOnFirstPage && logoutBtn) {
    logoutBtn.remove();
  }
}

// Initialize authentication check
document.addEventListener('DOMContentLoaded', function() {
    checkAuthentication();
    manageLogoutButton();
});
