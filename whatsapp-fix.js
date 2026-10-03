// Enhanced WhatsApp button functionality with Desktop app priority
// This file now supports both WhatsApp Desktop and Web with automatic fallback

// Function to create WhatsApp URLs (both desktop and web)
function createWhatsAppLink(phoneNumber, message) {
  // Format the phone number (remove any non-digit characters except +)
  let formattedPhone = phoneNumber.replace(/[\s-()]/g, '');
  
  // Ensure proper phone number formatting
  if (formattedPhone.startsWith('+')) {
    formattedPhone = formattedPhone.substring(1);
  }
  
  // Encode the message for URL
  const encodedMessage = encodeURIComponent(message);
  
  // Return both desktop and web URLs
  return {
    desktop: `whatsapp://send?phone=${formattedPhone}&text=${encodedMessage}`,
    web: `https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`
  };
}

// Enhanced function to handle WhatsApp button click with Desktop-first approach
function handleWhatsAppButtonClick(phoneNumber, message, buttonElement) {
  const urls = createWhatsAppLink(phoneNumber, message);
  
  // Try WhatsApp Desktop first
  try {
    // Create a temporary link for desktop app
    const desktopLink = document.createElement('a');
    desktopLink.href = urls.desktop;
    desktopLink.style.display = 'none';
    document.body.appendChild(desktopLink);
    
    // Attempt to open desktop app
    desktopLink.click();
    
    // Fallback to web version after delay
    setTimeout(() => {
      window.open(urls.web, '_blank', 'noopener,noreferrer');
    }, 1500);
    
    // Clean up
    document.body.removeChild(desktopLink);
    
  } catch (error) {
    // Immediate fallback if desktop attempt fails
    console.log('WhatsApp Desktop failed, using web:', error);
    window.open(urls.web, '_blank', 'noopener,noreferrer');
  }
  
  // Update button state
  if (buttonElement) {
    buttonElement.textContent = '✓ Sent';
    buttonElement.classList.add('bg-success');
    buttonElement.disabled = true;
  }
  
  return true;
}

// Function to create a WhatsApp button that works on mobile
function createMobileWhatsAppButton(phoneNumber, message, buttonText = '📱', buttonClass = 'whatsapp-notice-btn action-button-success') {
  // Create wrapper for better touch handling
  const wrapper = document.createElement('div');
  wrapper.className = 'whatsapp-btn-wrapper';
  
  // Create the button
  const button = document.createElement('button');
  button.type = 'button';
  button.className = buttonClass;
  button.textContent = buttonText;
  button.title = 'Send WhatsApp Message';
  
  // Handle button click with desktop-first approach
  button.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Use the enhanced WhatsApp opening function
    handleWhatsAppButtonClick(phoneNumber, message, button);
  });
  
  // Assemble the components
  wrapper.appendChild(button);
  
  return wrapper;
}

// Function to replace existing WhatsApp buttons with mobile-friendly ones
function enhanceExistingWhatsAppButtons() {
  // Find all WhatsApp buttons
  const whatsappButtons = document.querySelectorAll('.whatsapp-notice-btn');
  
  whatsappButtons.forEach(button => {
    // Skip if already enhanced or disabled
    if (button.dataset.enhanced === 'true' || button.disabled) {
      return;
    }
    
    // Get parent element
    const parent = button.parentElement;
    
    // Get data from parent element or button
    const phoneNumber = button.dataset.phone || parent.dataset.phone;
    const message = button.dataset.message || parent.dataset.message;
    
    if (phoneNumber) {
      // Create a wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'whatsapp-btn-wrapper';
      
      // Add enhanced click handler to existing button
      const originalOnClick = button.onclick;
      button.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Use the enhanced WhatsApp opening function
        handleWhatsAppButtonClick(phoneNumber, message || 'Hello from GoRouteX', button);
        
        // Call original onclick if it existed
        if (originalOnClick) {
          originalOnClick.call(this, e);
        }
      };
      
      // Insert the wrapper before the button
      parent.insertBefore(wrapper, button);
      
      // Move the button into the wrapper
      wrapper.appendChild(button);
      
      // Mark as enhanced
      button.dataset.enhanced = 'true';
    }
  });
}



// Run enhancement when DOM is loaded and periodically for dynamically added buttons
document.addEventListener('DOMContentLoaded', function() {
  enhanceExistingWhatsAppButtons();
  
  // Set interval to check for new buttons
  setInterval(enhanceExistingWhatsAppButtons, 2000);
});
