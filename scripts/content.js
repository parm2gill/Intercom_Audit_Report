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
  
  // 1. Broadly query any potential message elements
  let messageBlocks = Array.from(container.querySelectorAll(
    '[data-testid="conversation-part"], .conversation-part, .im-message-body, .conversation-part__container, ' +
    '[data-testid*="message"], [class*="conversation-part"], [class*="message-part"], [class*="message-body"], ' +
    'div[class*="message"], div[class*="part"], div[class*="bubble"], div[class*="body"]'
  ));
  
  // 2. Filter down to elements that actually contain text
  messageBlocks = messageBlocks.filter(el => {
    const txt = el.innerText ? el.innerText.trim() : '';
    return txt.length > 0 && txt.length < 2000; // exclude full wrapper containers
  });

  // 3. Filter out parent elements to keep only the leaf-most message nodes (prevents duplicate bubbles)
  messageBlocks = messageBlocks.filter(el => {
    return !messageBlocks.some(other => other !== el && el.contains(other));
  });

  // 4. Fallback if empty: use direct children containing text
  if (messageBlocks.length === 0) {
    messageBlocks = Array.from(container.children).filter(el => {
      const txt = el.innerText ? el.innerText.trim() : '';
      return txt.length > 0;
    });
  }
  
  messageBlocks.forEach((block, index) => {
    // Determine Text Content
    let text = block.innerText ? block.innerText.trim() : '';
    if (!text || text.includes('Exclude from CSAT')) return;

    // Determine Sender Type & Timestamp by traversing up to find metadata/context
    let senderType = 'unknown';
    let timestamp = '';
    
    let current = block;
    while (current && current !== container) {
      const classList = current.className || '';
      const dataTestId = current.getAttribute('data-testid') || '';
      
      if (typeof classList === 'string') {
        if (
          classList.includes('customer') || 
          dataTestId.includes('customer') || 
          current.querySelector('.conversation-part__metadata--customer')
        ) {
          senderType = 'customer';
        } else if (
          classList.includes('admin') || 
          classList.includes('agent') || 
          dataTestId.includes('admin') || 
          dataTestId.includes('agent') || 
          current.querySelector('.conversation-part__metadata--admin')
        ) {
          senderType = 'agent';
        }
      }
      
      const timeElement = current.querySelector('time, .conversation-part__time, .conversation-part__metadata');
      if (timeElement && !timestamp) {
        timestamp = timeElement.getAttribute('datetime') || timeElement.getAttribute('title') || '';
      }
      
      current = current.parentElement;
    }

    // Fallbacks for sender detection
    if (senderType === 'unknown') {
      const metadataText = block.querySelector('.conversation-part__metadata')?.innerText || '';
      if (metadataText.toLowerCase().includes('you') || metadataText.toLowerCase().includes('support')) {
        senderType = 'agent';
      } else if (metadataText.length > 0) {
        senderType = 'customer';
      } else {
        // Default to customer (safest fallback for SLA calculation)
        senderType = 'customer';
      }
    }

    // Default timestamp fallback
    if (!timestamp) {
      const titledEl = block.querySelector('[title]');
      if (titledEl) {
        timestamp = titledEl.getAttribute('title');
      }
    }

    if (!timestamp) {
      timestamp = new Date(Date.now() - (messageBlocks.length - index) * 60000).toISOString();
    } else {
      try {
        const parsedDate = new Date(timestamp);
        if (!isNaN(parsedDate.getTime())) {
          timestamp = parsedDate.toISOString();
        }
      } catch (e) {
        // keep raw
      }
    }

    // Detect Automated Bot or System messages
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
