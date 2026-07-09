// Content Script for Intercom Chat Auditor

const CHAT_CONTAINER_SELECTORS = [
  '[data-testid="conversation-pane"]',
  '.conversation-pane',
  '.conversation-scrollable',
  '.conversation__messages',
  '.im-conversation-messages-list',
  '.conversation__history',
  '.conversation-scroller'
];

const SIDEBAR_SELECTORS = [
  '[data-testid="conversation-sidebar"]',
  '.conversation-sidebar',
  '.sidebar',
  '[data-testid="attribute-list"]',
  '.right-sidebar',
  '.user-profile-sidebar'
];

/**
 * Finds the scrollable chat container.
 */
function findChatContainer() {
  for (const selector of CHAT_CONTAINER_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // Fallback scrollable lookup
  const divs = Array.from(document.querySelectorAll('div'));
  const scrollables = divs.filter(div => {
    const style = window.getComputedStyle(div);
    const hasScroll = (style.overflowY === 'auto' || style.overflowY === 'scroll');
    const isVisible = div.scrollHeight > div.clientHeight && div.clientHeight > 200 && div.clientWidth > 300;
    return hasScroll && isVisible;
  });

  if (scrollables.length > 0) {
    return scrollables.reduce((best, current) => {
      const currentRect = current.getBoundingClientRect();
      const bestRect = best.getBoundingClientRect();
      if (currentRect.left > bestRect.left && current.innerText.length > 50) {
        return current;
      }
      return current.innerText.length > best.innerText.length ? current : best;
    }, scrollables[0]);
  }
  return null;
}

/**
 * Finds the right sidebar panel.
 */
function findRightSidebar() {
  for (const selector of SIDEBAR_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  const divs = Array.from(document.querySelectorAll('div'));
  const rightPanels = divs.filter(div => {
    const rect = div.getBoundingClientRect();
    const isRightSide = rect.left > window.innerWidth * 0.5;
    const isBigEnough = rect.width > 200 && rect.height > window.innerHeight * 0.4;
    return isRightSide && isBigEnough;
  });

  return rightPanels.length > 0 ? rightPanels[0] : null;
}

/**
 * Scrolls the chat container to the top to load lazy-loaded elements.
 */
async function scrollChatToTop(container) {
  return new Promise((resolve) => {
    let lastScrollHeight = container.scrollHeight;
    let sameHeightCount = 0;
    let maxAttempts = 15;
    let attempts = 0;

    const timer = setInterval(() => {
      container.scrollTop = 0;
      attempts++;

      setTimeout(() => {
        const currentScrollHeight = container.scrollHeight;
        if (currentScrollHeight === lastScrollHeight) {
          sameHeightCount++;
          if (sameHeightCount >= 3 || attempts >= maxAttempts) {
            clearInterval(timer);
            resolve();
          }
        } else {
          sameHeightCount = 0;
          lastScrollHeight = currentScrollHeight;
        }
      }, 300);
    }, 500);
  });
}

/**
 * Chronologically extracts message objects with metadata and precise timestamps.
 */
function parseChatMessages(container) {
  const messages = [];
  
  // Look for message parts inside Intercom chat container
  // Intercom typically wraps message elements inside specific classes/roles.
  const messageBlocks = Array.from(container.querySelectorAll('[data-testid="conversation-part"], .conversation-part, .im-message-body, .conversation-part__container'));
  
  messageBlocks.forEach((block, index) => {
    // 1. Determine Sender Type
    let senderType = 'unknown';
    const classList = block.className || '';
    
    // Intercom differentiates customer vs agent visually and in data attributes
    if (block.querySelector('.conversation-part__metadata--customer') || classList.includes('customer') || block.closest('.conversation-part--customer')) {
      senderType = 'customer';
    } else if (block.querySelector('.conversation-part__metadata--admin') || classList.includes('admin') || classList.includes('agent') || block.closest('.conversation-part--admin')) {
      senderType = 'agent';
    } else {
      // Fallback text check
      const metadataText = block.querySelector('.conversation-part__metadata')?.innerText || '';
      if (metadataText.toLowerCase().includes('you') || metadataText.toLowerCase().includes('support')) {
        senderType = 'agent';
      } else if (metadataText.length > 0) {
        senderType = 'customer';
      }
    }
    
    // 2. Extract Message Text
    const textElement = block.querySelector('.conversation-part__body, .im-message-body__text') || block;
    let text = textElement.innerText ? textElement.innerText.trim() : '';
    
    // Ignore empty/system notes
    if (!text || text.includes('Exclude from CSAT')) return;

    // 3. Extract Precise Timestamps
    const timeElement = block.querySelector('time, .conversation-part__time, .conversation-part__metadata');
    let timestamp = '';
    
    if (timeElement) {
      timestamp = timeElement.getAttribute('datetime') || timeElement.getAttribute('title') || '';
    }
    
    if (!timestamp) {
      // Look for any child or attribute with a date/time title
      const titledEl = block.querySelector('[title]');
      if (titledEl) {
        timestamp = titledEl.getAttribute('title');
      }
    }

    // Default to approximate sequential date if missing
    if (!timestamp) {
      timestamp = new Date(Date.now() - (messageBlocks.length - index) * 60000).toISOString();
    } else {
      // Parse to standard ISO string if readable
      try {
        const parsedDate = new Date(timestamp);
        if (!isNaN(parsedDate.getTime())) {
          timestamp = parsedDate.toISOString();
        }
      } catch (e) {
        // keep as raw text
      }
    }

    // 4. Detect Automated Bot or System messages
    let isBot = false;
    const textLower = text.toLowerCase();
    if (
      textLower.includes('by proceeding, you agree') ||
      textLower.includes('enter the exam sku') ||
      textLower.includes('explain the issue') ||
      textLower.includes('this could be a duplicate') ||
      textLower.includes('assigned to') ||
      textLower.includes('operator') ||
      block.querySelector('.operator, .bot-avatar')
    ) {
      isBot = true;
    }

    messages.push({
      senderType,
      text,
      timestamp,
      isBot
    });
  });

  return messages;
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'extractChatAndAudit') {
    (async () => {
      try {
        const container = findChatContainer();
        if (!container) {
          sendResponse({ success: false, error: 'Could not locate the conversation pane. Please open an active Intercom conversation.' });
          return;
        }

        // 1. Scroll to top to load history
        await scrollChatToTop(container);

        // 2. Chronologically parse messages
        const messages = parseChatMessages(container);

        if (messages.length === 0) {
          sendResponse({ success: false, error: 'Parsed 0 messages. Please make sure the chat pane is fully loaded.' });
          return;
        }

        // 3. Extract sidebar data for metadata check
        const sidebar = findRightSidebar();
        const sidebarText = sidebar ? sidebar.innerText : '';
        const bodyText = document.body.innerText;

        sendResponse({
          success: true,
          messages: messages,
          sidebarText: sidebarText,
          bodyText: bodyText
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
