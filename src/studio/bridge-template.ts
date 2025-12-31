/**
 * Studio Bridge Client Template
 *
 * This JavaScript runs in the browser when the renderer is embedded in Studio iframe.
 * It handles:
 * - postMessage communication with Studio
 * - Console log capture
 * - DOM tree tracking for Navigator
 * - Error reporting
 * - Navigation events
 */

export interface StudioBridgeOptions {
  projectId: string;
  pageId: string;
  pagePath?: string;
}

export function generateStudioBridgeScript(options: StudioBridgeOptions): string {
  return `(function() {
  'use strict';

  // Configuration from server
  const PROJECT_ID = ${JSON.stringify(options.projectId)};
  const PAGE_ID = ${JSON.stringify(options.pageId)};
  const PAGE_PATH = ${JSON.stringify(options.pagePath || options.pageId)};

  // Data attributes
  const DATA_VF_ID = 'data-vf-id';
  const DATA_VF_SELECTOR = 'data-vf-selector';
  const DATA_VF_TEXT = 'data-vf-text';
  const DATA_VF_IGNORE = 'data-vf-ignore';
  const DATA_VF_SELECTION = 'data-vf-selection';

  // Position data attributes (from remark-node-id plugin)
  const DATA_NODE_LINE = 'data-node-line';
  const DATA_NODE_COLUMN = 'data-node-column';
  const DATA_NODE_END_LINE = 'data-node-end-line';
  const DATA_NODE_END_COLUMN = 'data-node-end-column';

  // State
  let inspectMode = false;
  let selectedNodeId = null;
  let hoveredNodeId = null;
  let lastTreeSignature = '';

  // Overlay elements
  let hoverOverlay = null;
  let selectionOverlay = null;

  // ============ Visual Overlay System ============

  function injectOverlayStyles() {
    if (document.getElementById('vf-overlay-styles')) return;

    const style = document.createElement('style');
    style.id = 'vf-overlay-styles';
    style.textContent = \`
      .vf-overlay {
        position: fixed;
        pointer-events: none;
        z-index: 99999;
        box-sizing: border-box;
        transition: all 0.05s ease-out;
      }
      .vf-overlay-hover {
        border: 2px solid #0081F8;
        background: rgba(0, 129, 248, 0.05);
      }
      .vf-overlay-selection {
        border: 2px solid #0081F8;
        background: rgba(0, 129, 248, 0.1);
      }
      .vf-overlay-label {
        position: absolute;
        top: -22px;
        left: -2px;
        background: #0081F8;
        color: white;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 2px 6px;
        border-radius: 3px 3px 0 0;
        white-space: nowrap;
        pointer-events: none;
      }
      .vf-overlay-label-bottom {
        top: auto;
        bottom: -22px;
        border-radius: 0 0 3px 3px;
      }
    \`;
    document.head.appendChild(style);
  }

  function createOverlay(type) {
    const overlay = document.createElement('div');
    overlay.className = 'vf-overlay vf-overlay-' + type;
    overlay.setAttribute(DATA_VF_IGNORE, 'true');

    const label = document.createElement('div');
    label.className = 'vf-overlay-label';
    overlay.appendChild(label);

    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    return overlay;
  }

  function positionOverlay(overlay, element, nodeName) {
    if (!element || !overlay) {
      if (overlay) overlay.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();

    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    const label = overlay.querySelector('.vf-overlay-label');
    if (label) {
      label.textContent = nodeName || element.tagName.toLowerCase();
      // Position label below if element is near top of viewport
      if (rect.top < 24) {
        label.classList.add('vf-overlay-label-bottom');
      } else {
        label.classList.remove('vf-overlay-label-bottom');
      }
    }
  }

  function hideOverlay(overlay) {
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  function getNodeName(element) {
    const vfId = element.getAttribute(DATA_VF_ID);
    if (vfId) {
      return vfId.split('_')[0];
    }
    return element.tagName.toLowerCase();
  }

  function findElementById(nodeId) {
    if (!nodeId) return null;
    return document.querySelector('[' + DATA_VF_ID + '="' + nodeId + '"]') ||
           document.querySelector('[' + DATA_VF_SELECTOR + '="' + nodeId + '"]');
  }

  // ============ PostMessage Utilities ============

  function postToStudio(message) {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(message, '*');
      } catch (e) {
        console.debug('[StudioBridge] postMessage failed:', e);
      }
    }
  }

  function isFromStudio(event) {
    // Accept messages from Studio domains
    const origin = event.origin || '';
    return (
      origin.includes('veryfront.org') ||
      origin.includes('veryfront.com') ||
      origin.includes('localhost') ||
      origin.includes('lvh.me')
    );
  }

  // ============ Console Capture ============

  const originalConsole = {};
  const consoleMethods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'clear', 'dir'];

  let logCounter = 0;

  function setupConsoleCapture() {
    consoleMethods.forEach(method => {
      originalConsole[method] = console[method];
      console[method] = function(...args) {
        // Call original
        originalConsole[method].apply(console, args);

        // Generate unique ID for log entry
        const logId = 'vf-' + Date.now() + '-' + (++logCounter);

        // Format data - console-feed expects specific encoded format
        // We send a pre-decoded log with id since we can't use console-feed Encode
        const formattedData = args.map(arg => {
          try {
            if (arg instanceof Error) {
              return { __isError: true, message: arg.message, stack: arg.stack, name: arg.name };
            }
            if (arg === undefined) {
              return { __isUndefined: true };
            }
            if (arg === null) {
              return null;
            }
            if (typeof arg === 'function') {
              return { __isFunction: true, name: arg.name || 'anonymous' };
            }
            if (typeof arg === 'symbol') {
              return { __isSymbol: true, description: arg.description };
            }
            if (typeof arg === 'object') {
              // Deep clone to avoid circular refs
              return JSON.parse(JSON.stringify(arg));
            }
            return arg;
          } catch (e) {
            return String(arg);
          }
        });

        // Send to Studio - include id for Log interface compatibility
        postToStudio({
          action: 'logEvent',
          value: {
            id: logId,
            method: method,
            data: formattedData,
            timestamp: new Date().toISOString()
          }
        });
      };
    });
  }

  function restoreConsole() {
    consoleMethods.forEach(method => {
      if (originalConsole[method]) {
        console[method] = originalConsole[method];
      }
    });
  }

  // ============ Error Handling ============

  function setupErrorHandling() {
    window.addEventListener('error', function(event) {
      postToStudio({
        action: 'runtimeError',
        url: window.location.href,
        errors: [{
          type: 'error',
          message: event.message,
          file: event.filename,
          line: event.lineno,
          column: event.colno
        }]
      });
    });

    window.addEventListener('unhandledrejection', function(event) {
      const reason = event.reason;
      postToStudio({
        action: 'runtimeError',
        url: window.location.href,
        errors: [{
          type: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
          file: reason instanceof Error ? reason.stack : undefined
        }]
      });
    });
  }

  // ============ DOM Tree Building ============

  const DOM_IGNORE_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'];

  function isValidElement(el) {
    return (
      el &&
      el.nodeType === Node.ELEMENT_NODE &&
      !DOM_IGNORE_TAGS.includes(el.tagName) &&
      !el.hasAttribute(DATA_VF_IGNORE) &&
      el.style.display !== 'none'
    );
  }

  function getNodeType(el) {
    const tagName = el.tagName.toLowerCase();

    // Check if it's a component (uppercase first letter in data-vf-id suggests component)
    const vfId = el.getAttribute(DATA_VF_ID) || '';
    if (vfId && /^[A-Z]/.test(vfId)) {
      return 'component';
    }

    // Text nodes
    if (el.hasAttribute(DATA_VF_TEXT)) {
      return 'text';
    }

    // Markdown elements
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code'].includes(tagName)) {
      return 'markdown';
    }

    return 'element';
  }

  function buildNavigatorTree(root) {
    let nodeIndex = 0;

    function processElement(el, parentId) {
      if (!isValidElement(el)) {
        // Process children even if element is skipped
        const children = [];
        Array.from(el.children || []).forEach(child => {
          const childNodes = processElement(child, parentId);
          children.push(...childNodes);
        });
        return children;
      }

      // Get existing ID or generate and inject one
      let id = el.getAttribute(DATA_VF_ID) || el.getAttribute(DATA_VF_SELECTOR);
      if (!id) {
        // Generate a selector ID and inject it into the DOM for later selection/highlighting
        id = 'vf-' + el.tagName.toLowerCase() + '-' + (++nodeIndex);
        el.setAttribute(DATA_VF_SELECTOR, id);
      }
      const type = getNodeType(el);
      const name = el.getAttribute(DATA_VF_ID)
        ? el.getAttribute(DATA_VF_ID).split('_')[0]
        : el.tagName.toLowerCase();

      // Read position data from remark-node-id plugin attributes
      const startLine = parseInt(el.getAttribute(DATA_NODE_LINE) || '0', 10);
      const startColumn = parseInt(el.getAttribute(DATA_NODE_COLUMN) || '0', 10);
      const endLine = parseInt(el.getAttribute(DATA_NODE_END_LINE) || '0', 10);
      const endColumn = parseInt(el.getAttribute(DATA_NODE_END_COLUMN) || '0', 10);

      const node = {
        id: id,
        name: name,
        type: type,
        path: PAGE_PATH, // Use relative file path for Studio entity resolution
        parentId: parentId,
        start: { line: startLine, column: startColumn },
        end: { line: endLine, column: endColumn },
        children: [],
        text: el.hasAttribute(DATA_VF_TEXT) ? el.textContent?.trim() : undefined,
        isRemote: false
      };

      // Process children
      Array.from(el.children || []).forEach(child => {
        const childNodes = processElement(child, id);
        node.children.push(...childNodes);
      });

      return [node];
    }

    const rootNode = {
      id: 'root',
      name: 'root',
      type: 'root',
      path: '',
      parentId: '',
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
      children: []
    };

    Array.from(root.children || []).forEach(child => {
      const nodes = processElement(child, 'root');
      rootNode.children.push(...nodes);
    });

    return rootNode;
  }

  function createTreeSignature(root) {
    // Count all valid elements (not just those with data-vf-* attributes)
    // This ensures tree updates are detected even before attributes are injected
    const allElements = root.querySelectorAll('*');
    const validElements = Array.from(allElements).filter(el => isValidElement(el));
    return validElements.length + '-' + validElements.map(el => el.tagName).join('');
  }

  // ============ MutationObserver for Tree Updates ============

  let treeUpdateTimer = null;
  let mutationObserver = null;

  function sendTreeUpdate() {
    const root = document.getElementById('root') || document.body;
    if (!root) return;

    const signature = createTreeSignature(root);
    if (signature === lastTreeSignature) return;
    lastTreeSignature = signature;

    const tree = buildNavigatorTree(root);
    postToStudio({
      action: 'treeUpdated',
      id: PAGE_ID,
      url: window.location.href,
      tree: tree,
      sourceHash: window.__VERYFRONT_SOURCE_HASH__ || null
    });
  }

  function debouncedTreeUpdate() {
    if (treeUpdateTimer) clearTimeout(treeUpdateTimer);
    treeUpdateTimer = setTimeout(sendTreeUpdate, 150);
  }

  function setupMutationObserver() {
    const root = document.getElementById('root') || document.body;
    if (!root) return;

    mutationObserver = new MutationObserver(function(mutations) {
      const hasRelevantChanges = mutations.some(m =>
        m.type === 'childList' || m.type === 'characterData'
      );
      if (hasRelevantChanges) {
        debouncedTreeUpdate();
      }
    });

    mutationObserver.observe(root, {
      childList: true,
      characterData: true,
      subtree: true
    });

    // Initial tree update
    sendTreeUpdate();
  }

  // ============ Element Selection & Highlighting ============

  function showHoverOverlay(nodeId) {
    if (!nodeId) {
      hideOverlay(hoverOverlay);
      return;
    }

    const el = findElementById(nodeId);
    if (el && hoverOverlay) {
      positionOverlay(hoverOverlay, el, getNodeName(el));
    } else {
      hideOverlay(hoverOverlay);
    }
  }

  function showSelectionOverlay(nodeId) {
    if (!nodeId) {
      hideOverlay(selectionOverlay);
      return;
    }

    const el = findElementById(nodeId);
    if (el && selectionOverlay) {
      positionOverlay(selectionOverlay, el, getNodeName(el));
    } else {
      hideOverlay(selectionOverlay);
    }
  }

  function highlightElement(nodeId) {
    // Remove previous highlights (data attribute based)
    document.querySelectorAll('[' + DATA_VF_SELECTION + ']').forEach(el => {
      el.removeAttribute(DATA_VF_SELECTION);
    });

    if (!nodeId) {
      hideOverlay(hoverOverlay);
      return;
    }

    // Find and highlight element with data attribute
    const el = findElementById(nodeId);
    if (el) {
      el.setAttribute(DATA_VF_SELECTION, 'true');
      // Show visual overlay for hover state
      if (inspectMode && hoverOverlay) {
        positionOverlay(hoverOverlay, el, getNodeName(el));
      }
    }
  }

  function scrollToElement(nodeId) {
    const el = document.querySelector('[' + DATA_VF_ID + '="' + nodeId + '"]') ||
               document.querySelector('[' + DATA_VF_SELECTOR + '*="' + nodeId + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setupInspectMode() {
    document.addEventListener('click', function(event) {
      if (!inspectMode) return;

      event.preventDefault();
      event.stopPropagation();

      const target = event.target.closest('[' + DATA_VF_ID + '], [' + DATA_VF_SELECTOR + ']');
      if (target) {
        const id = target.getAttribute(DATA_VF_ID) || target.getAttribute(DATA_VF_SELECTOR);
        selectedNodeId = id;
        showSelectionOverlay(id);
        postToStudio({ action: 'setSelectedNode', id: id });
      }
    }, true);

    document.addEventListener('mouseover', function(event) {
      if (!inspectMode) return;

      const target = event.target.closest('[' + DATA_VF_ID + '], [' + DATA_VF_SELECTOR + ']');
      if (target) {
        const id = target.getAttribute(DATA_VF_ID) || target.getAttribute(DATA_VF_SELECTOR);
        if (id !== hoveredNodeId) {
          hoveredNodeId = id;
          showHoverOverlay(id);
        }
      }
    });

    document.addEventListener('mouseout', function(event) {
      if (!inspectMode) return;

      const target = event.target.closest('[' + DATA_VF_ID + '], [' + DATA_VF_SELECTOR + ']');
      if (target) {
        // Check if we're moving to a child element (still within the same target)
        const relatedTarget = event.relatedTarget;
        if (relatedTarget && target.contains(relatedTarget)) {
          return;
        }
        hoveredNodeId = null;
        hideOverlay(hoverOverlay);
      }
    });

    // Update overlays on scroll/resize
    window.addEventListener('scroll', function() {
      if (inspectMode && hoveredNodeId) {
        showHoverOverlay(hoveredNodeId);
      }
      if (selectedNodeId) {
        showSelectionOverlay(selectedNodeId);
      }
    }, true);

    window.addEventListener('resize', function() {
      if (inspectMode && hoveredNodeId) {
        showHoverOverlay(hoveredNodeId);
      }
      if (selectedNodeId) {
        showSelectionOverlay(selectedNodeId);
      }
    });
  }

  // ============ Color Mode ============

  function setColorMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(mode);
  }

  // ============ Studio Message Handler ============

  function handleStudioMessage(event) {
    if (!isFromStudio(event)) return;

    const message = event.data;
    if (!message || !message.action) return;

    switch (message.action) {
      case 'routeChange':
        if (message.url) {
          postToStudio({
            action: 'onPageTransitionStart',
            url: message.url,
            projectId: PROJECT_ID
          });
          window.location.href = message.url;
        }
        break;

      case 'reload':
        window.location.reload();
        break;

      case 'goBack':
        window.history.back();
        break;

      case 'goForward':
        window.history.forward();
        break;

      case 'colorMode':
        setColorMode(message.value);
        break;

      case 'toggleInspectMode':
        inspectMode = message.value;
        if (!inspectMode) {
          hideOverlay(hoverOverlay);
          hoveredNodeId = null;
          if (message.deselectElements) {
            hideOverlay(selectionOverlay);
            selectedNodeId = null;
          }
        }
        break;

      case 'setSelectedNode':
        selectedNodeId = message.id;
        showSelectionOverlay(message.id);
        if (message.scroll) {
          scrollToElement(message.id);
        }
        break;

      case 'setHoveredNode':
        if (!inspectMode) {
          showHoverOverlay(message.id);
        }
        break;

      case 'toggleLayout':
        // Layout toggling handled by the renderer
        break;

      default:
        console.debug('[StudioBridge] Unknown action:', message.action);
    }
  }

  // ============ Lifecycle Events ============

  function notifyAppLoaded() {
    postToStudio({
      action: 'appLoaded',
      url: window.location.href
    });

    postToStudio({
      action: 'appUpdated',
      url: window.location.href,
      id: PAGE_ID,
      isInitialLoad: true,
      errors: [],
      warnings: []
    });

    postToStudio({
      action: 'onPageTransitionEnd',
      url: window.location.href,
      projectId: PROJECT_ID,
      id: PAGE_ID,
      params: {}
    });
  }

  function notifyAppUnloaded() {
    postToStudio({
      action: 'appUnloaded',
      url: window.location.href
    });
  }

  // ============ Initialization ============

  function init() {
    // Check if we're in Studio iframe or studio_embed mode for testing
    const params = new URLSearchParams(window.location.search);
    const studioEmbed = params.get('studio_embed') === 'true';

    if (window.parent === window && !studioEmbed) {
      console.debug('[StudioBridge] Not in iframe and not studio_embed mode, skipping initialization');
      return;
    }

    console.debug('[StudioBridge] Initializing...');

    // Inject overlay styles and create overlay elements
    injectOverlayStyles();
    hoverOverlay = createOverlay('hover');
    selectionOverlay = createOverlay('selection');

    // Setup all handlers
    setupConsoleCapture();
    setupErrorHandling();
    setupInspectMode();

    // Listen for Studio messages
    window.addEventListener('message', handleStudioMessage);

    // Notify Studio when page loads
    // IMPORTANT: notifyAppLoaded() must be called BEFORE setupMutationObserver()
    // because notifyAppLoaded sends onPageTransitionEnd which sets previewId,
    // and treeUpdated (from setupMutationObserver) requires previewId to be set
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        notifyAppLoaded();
        setupMutationObserver();
      });
    } else {
      notifyAppLoaded();
      setupMutationObserver();
    }

    // Notify Studio when page unloads
    window.addEventListener('beforeunload', notifyAppUnloaded);

    // Handle query params (reuse params from above)
    const colorMode = params.get('color_mode');
    if (colorMode) {
      setColorMode(colorMode);
    }

    // Initialize inspect mode from query params
    const inspectModeParam = params.get('inspect_mode');
    if (inspectModeParam === 'true') {
      inspectMode = true;
      console.debug('[StudioBridge] Inspect mode enabled from query param');
    }

    console.debug('[StudioBridge] Initialized successfully');
  }

  // Start initialization
  init();
})();`;
}
