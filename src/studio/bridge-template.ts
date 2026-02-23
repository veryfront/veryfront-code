export interface StudioBridgeOptions {
  projectId: string;
  pageId: string;
  pagePath?: string;
}

export function generateStudioBridgeScript(options: StudioBridgeOptions): string {
  return `(function() {
  'use strict';

  const PROJECT_ID = ${JSON.stringify(options.projectId)};
  const PAGE_ID = ${JSON.stringify(options.pageId)};
  const PAGE_PATH = ${JSON.stringify(options.pagePath ?? options.pageId)};

  const DATA_VF_ID = 'data-vf-id';
  const DATA_VF_SELECTOR = 'data-vf-selector';
  const DATA_VF_TEXT = 'data-vf-text';
  const DATA_VF_IGNORE = 'data-vf-ignore';

  const DATA_NODE_ID = 'data-node-id';
  const DATA_NODE_LINE = 'data-node-line';
  const DATA_NODE_COLUMN = 'data-node-column';
  const DATA_NODE_END_LINE = 'data-node-end-line';
  const DATA_NODE_END_COLUMN = 'data-node-end-column';

  let inspectMode = false;
  let selectedNodeId = null;
  let hoveredNodeId = null;
  let lastTreeSignature = '';

  let hoverOverlay = null;
  let selectionOverlay = null;

  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(function() {
        fn.apply(this, args);
      }, ms);
    };
  }

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

  function hideOverlay(overlay) {
    if (overlay) overlay.style.display = 'none';
  }

  function positionOverlay(overlay, element, nodeName) {
    if (!overlay) return;
    if (!element) {
      hideOverlay(overlay);
      return;
    }

    const rect = element.getBoundingClientRect();

    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    const label = overlay.querySelector('.vf-overlay-label');
    if (!label) return;

    label.textContent = nodeName || element.tagName.toLowerCase();
    if (rect.top < 24) {
      label.classList.add('vf-overlay-label-bottom');
    } else {
      label.classList.remove('vf-overlay-label-bottom');
    }
  }

  function getNodeName(element) {
    const vfId = element.getAttribute(DATA_VF_ID);
    if (vfId) return vfId.split('_')[0];
    return element.tagName.toLowerCase();
  }

  function findElementById(nodeId) {
    if (!nodeId) return null;
    return (
      document.querySelector('[' + DATA_VF_ID + '="' + nodeId + '"]') ||
      document.querySelector('[' + DATA_VF_SELECTOR + '="' + nodeId + '"]') ||
      document.querySelector('[' + DATA_NODE_ID + '="' + nodeId + '"]')
    );
  }

  function postToStudio(message) {
    if (!window.parent || window.parent === window) return;
    try {
      window.parent.postMessage(message, '*');
    } catch (e) {
      console.debug('[StudioBridge] postMessage failed:', e);
    }
  }

  function isFromStudio(event) {
    const origin = event.origin || '';
    return (
      origin.includes('veryfront.org') ||
      origin.includes('veryfront.com') ||
      origin.includes('veryfront.dev') ||
      origin.includes('localhost')
    );
  }

  const originalConsole = {};
  const consoleMethods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'clear', 'dir'];
  let logCounter = 0;

  function setupConsoleCapture() {
    consoleMethods.forEach(method => {
      originalConsole[method] = console[method];
      console[method] = function(...args) {
        originalConsole[method].apply(console, args);

        const logId = 'vf-' + Date.now() + '-' + ++logCounter;

        const formattedData = args.map(arg => {
          try {
            if (arg instanceof Error) {
              return { __isError: true, message: arg.message, stack: arg.stack, name: arg.name };
            }
            if (arg === undefined) return { __isUndefined: true };
            if (arg === null) return null;
            if (typeof arg === 'function') return { __isFunction: true, name: arg.name || 'anonymous' };
            if (typeof arg === 'symbol') return { __isSymbol: true, description: arg.description };
            if (typeof arg === 'object') return JSON.parse(JSON.stringify(arg));
            return arg;
          } catch (e) {
            return String(arg);
          }
        });

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

  function setupErrorHandling() {
    function hideOverlays() {
      hideOverlay(hoverOverlay);
      hideOverlay(selectionOverlay);
    }

    window.addEventListener('error', function(event) {
      hideOverlays();
      postToStudio({
        action: 'runtimeError',
        url: window.location.href,
        errors: [
          {
            type: 'error',
            message: event.message,
            file: event.filename,
            line: event.lineno,
            column: event.colno
          }
        ]
      });
    });

    window.addEventListener('unhandledrejection', function(event) {
      hideOverlays();
      const reason = event.reason;
      postToStudio({
        action: 'runtimeError',
        url: window.location.href,
        errors: [
          {
            type: 'error',
            message: reason instanceof Error ? reason.message : String(reason),
            file: reason instanceof Error ? reason.stack : undefined
          }
        ]
      });
    });
  }

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

    const vfId = el.getAttribute(DATA_VF_ID) || '';
    if (vfId && /^[A-Z]/.test(vfId)) return 'component';
    if (el.hasAttribute(DATA_VF_TEXT)) return 'text';

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code'].includes(tagName)) {
      return 'markdown';
    }

    return 'element';
  }

  function buildNavigatorTree(root) {
    let nodeIndex = 0;

    function processElement(el, parentId) {
      if (!isValidElement(el)) {
        const children = [];
        Array.from(el.children || []).forEach(child => {
          children.push(...processElement(child, parentId));
        });
        return children;
      }

      let id = el.getAttribute(DATA_VF_ID) || el.getAttribute(DATA_NODE_ID) || el.getAttribute(DATA_VF_SELECTOR);
      if (!id) {
        id = 'vf-' + el.tagName.toLowerCase() + '-' + ++nodeIndex;
        el.setAttribute(DATA_VF_SELECTOR, id);
      }

      const vfId = el.getAttribute(DATA_VF_ID);
      const name = vfId ? vfId.split('_')[0] : el.tagName.toLowerCase();

      const node = {
        id: id,
        name: name,
        type: getNodeType(el),
        path: PAGE_PATH,
        parentId: parentId,
        start: {
          line: parseInt(el.getAttribute(DATA_NODE_LINE) || '0', 10),
          column: parseInt(el.getAttribute(DATA_NODE_COLUMN) || '0', 10)
        },
        end: {
          line: parseInt(el.getAttribute(DATA_NODE_END_LINE) || '0', 10),
          column: parseInt(el.getAttribute(DATA_NODE_END_COLUMN) || '0', 10)
        },
        children: [],
        text: el.hasAttribute(DATA_VF_TEXT) ? el.textContent?.trim() : undefined,
        isRemote: false
      };

      Array.from(el.children || []).forEach(child => {
        node.children.push(...processElement(child, id));
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
      rootNode.children.push(...processElement(child, 'root'));
    });

    return rootNode;
  }

  function createTreeSignature(root) {
    const validElements = Array.from(root.querySelectorAll('*')).filter(el => isValidElement(el));
    return validElements.length + '-' + validElements.map(el => el.tagName).join('');
  }

  let treeUpdateTimer = null;
  let mutationObserver = null;

  function sendTreeUpdate() {
    const root = document.getElementById('root') || document.body;
    if (!root) return;

    const signature = createTreeSignature(root);
    if (signature === lastTreeSignature) return;
    lastTreeSignature = signature;

    postToStudio({
      action: 'treeUpdated',
      id: PAGE_ID,
      url: window.location.href,
      tree: buildNavigatorTree(root),
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
      const hasRelevantChanges = mutations.some(m => m.type === 'childList' || m.type === 'characterData');
      if (hasRelevantChanges) debouncedTreeUpdate();
    });

    mutationObserver.observe(root, { childList: true, characterData: true, subtree: true });
    sendTreeUpdate();
  }

  function showOverlay(overlay, nodeId) {
    if (!nodeId) {
      hideOverlay(overlay);
      return;
    }

    const el = findElementById(nodeId);
    if (!el) {
      hideOverlay(overlay);
      return;
    }

    positionOverlay(overlay, el, getNodeName(el));
  }

  function showHoverOverlay(nodeId) {
    showOverlay(hoverOverlay, nodeId);
  }

  function showSelectionOverlay(nodeId) {
    showOverlay(selectionOverlay, nodeId);
  }

  function scrollToElement(nodeId) {
    const el =
      document.querySelector('[' + DATA_VF_ID + '="' + nodeId + '"]') ||
      document.querySelector('[' + DATA_NODE_ID + '="' + nodeId + '"]') ||
      document.querySelector('[' + DATA_VF_SELECTOR + '*="' + nodeId + '"]');

    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function setupInspectMode() {
    const INSPECTABLE_SELECTOR = '[' + DATA_VF_ID + '], [' + DATA_VF_SELECTOR + '], [' + DATA_NODE_ID + ']';

    function getElementId(el) {
      return el.getAttribute(DATA_VF_ID) || el.getAttribute(DATA_NODE_ID) || el.getAttribute(DATA_VF_SELECTOR);
    }

    document.addEventListener(
      'click',
      function(event) {
        if (!inspectMode) return;

        event.preventDefault();
        event.stopPropagation();

        const target = event.target.closest(INSPECTABLE_SELECTOR);
        if (!target) {
          selectedNodeId = null;
          hideOverlay(selectionOverlay);
          postToStudio({ action: 'setSelectedNode', id: null });
          return;
        }

        const id = getElementId(target);
        selectedNodeId = id;
        showSelectionOverlay(id);
        postToStudio({ action: 'setSelectedNode', id: id });
      },
      true
    );

    document.addEventListener('pointerover', function(event) {
      if (!inspectMode || event.pointerType === 'touch') return;

      const target = event.target.closest(INSPECTABLE_SELECTOR);
      if (!target) return;

      const id = getElementId(target);
      if (id === hoveredNodeId) return;

      hoveredNodeId = id;
      showHoverOverlay(id);
    });

    document.addEventListener('pointerout', function(event) {
      if (!inspectMode || event.pointerType === 'touch') return;

      const target = event.target.closest(INSPECTABLE_SELECTOR);
      if (!target) return;

      const relatedTarget = event.relatedTarget;
      if (relatedTarget && target.contains(relatedTarget)) return;

      hoveredNodeId = null;
      hideOverlay(hoverOverlay);
    });

    const updateOverlays = debounce(function() {
      if (inspectMode && hoveredNodeId) showHoverOverlay(hoveredNodeId);
      if (selectedNodeId) showSelectionOverlay(selectedNodeId);
    }, 16);

    window.addEventListener('scroll', updateOverlays, true);
    window.addEventListener('resize', updateOverlays);
  }

  function setColorMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(mode);
  }

  let html2canvasLoaded = false;
  let html2canvasPromise = null;

  function loadHtml2Canvas() {
    if (html2canvasLoaded) return Promise.resolve();
    if (html2canvasPromise) return html2canvasPromise;

    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.0/dist/html2canvas-pro.min.js';
      script.onload = () => {
        html2canvasLoaded = true;
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return html2canvasPromise;
  }

  async function captureScreenshot(options) {
    const { scrollTo, fullPage, quality = 0.8 } = options || {};
    const originalScrollY = window.scrollY;

    try {
      await loadHtml2Canvas();

      if (typeof scrollTo === 'number') {
        window.scrollTo(0, scrollTo);
        await new Promise(r => setTimeout(r, 150));
      }

      const canvasOptions = {
        useCORS: true,
        logging: false,
        scale: window.devicePixelRatio || 1
      };

      if (fullPage) {
        canvasOptions.height = document.documentElement.scrollHeight;
        canvasOptions.windowHeight = document.documentElement.scrollHeight;
        canvasOptions.y = 0;
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 100));
      }

      const html2canvasFn = window.html2canvas.default || window.html2canvas;
      const canvas = await html2canvasFn(document.body, canvasOptions);
      const dataUrl = canvas.toDataURL('image/png', quality);

      window.scrollTo(0, originalScrollY);

      return {
        success: true,
        data: dataUrl,
        width: canvas.width,
        height: canvas.height,
        scrollY: window.scrollY,
        totalHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        url: window.location.href
      };
    } catch (error) {
      window.scrollTo(0, originalScrollY);
      return {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  async function captureMultipleSections(sectionCount) {
    const originalScrollY = window.scrollY;
    const results = [];
    const totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    const sections = sectionCount || Math.ceil(totalHeight / viewportHeight);

    try {
      for (let i = 0; i < sections; i++) {
        const scrollY = Math.min(i * viewportHeight, totalHeight - viewportHeight);
        const result = await captureScreenshot({ scrollTo: scrollY });
        if (result.success) {
          results.push({ ...result, section: i + 1, totalSections: sections });
        }
      }
    } finally {
      window.scrollTo(0, originalScrollY);
    }

    return results;
  }

  function handleStudioMessage(event) {
    if (!isFromStudio(event)) return;

    const message = event.data;
    if (!message?.action) return;

    switch (message.action) {
      case 'routeChange':
        if (message.url) {
          postToStudio({ action: 'onPageTransitionStart', url: message.url, projectId: PROJECT_ID });
          window.location.href = message.url;
        }
        return;

      case 'reload':
        window.location.reload();
        return;

      case 'goBack':
        window.history.back();
        return;

      case 'goForward':
        window.history.forward();
        return;

      case 'colorMode':
        setColorMode(message.value);
        return;

      case 'toggleInspectMode':
        inspectMode = message.value;
        if (inspectMode) return;

        hideOverlay(hoverOverlay);
        hoveredNodeId = null;

        if (!message.deselectElements) return;

        hideOverlay(selectionOverlay);
        selectedNodeId = null;
        return;

      case 'setSelectedNode':
        selectedNodeId = message.id;
        showSelectionOverlay(message.id);
        if (message.scroll) scrollToElement(message.id);
        return;

      case 'setHoveredNode':
        if (!inspectMode) showHoverOverlay(message.id);
        return;

      case 'toggleLayout':
        return;

      case 'screenshot':
        (async function() {
          if (message.multipleSections) {
            const results = await captureMultipleSections(message.sectionCount);
            postToStudio({
              action: 'screenshotResult',
              requestId: message.requestId,
              multiple: true,
              results: results
            });
            return;
          }

          const result = await captureScreenshot(message.options);
          postToStudio({
            action: 'screenshotResult',
            requestId: message.requestId,
            multiple: false,
            ...result
          });
        })();
        return;

      default:
        console.debug('[StudioBridge] Unknown action:', message.action);
        return;
    }
  }

  function notifyAppLoaded() {
    postToStudio({ action: 'appLoaded', url: window.location.href });

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
    postToStudio({ action: 'appUnloaded', url: window.location.href });
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const studioEmbed = params.get('studio_embed') === 'true';

    if (window.parent === window && !studioEmbed) {
      console.debug('[StudioBridge] Not in iframe and not studio_embed mode, skipping initialization');
      return;
    }

    console.debug('[StudioBridge] Initializing...');

    injectOverlayStyles();
    hoverOverlay = createOverlay('hover');
    selectionOverlay = createOverlay('selection');

    setupConsoleCapture();
    setupErrorHandling();
    setupInspectMode();

    window.addEventListener('message', handleStudioMessage);

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

    window.addEventListener('beforeunload', notifyAppUnloaded);

    const colorMode = params.get('color_mode');
    if (colorMode) setColorMode(colorMode);

    const inspectModeParam = params.get('inspect_mode');
    if (inspectModeParam === 'true') {
      inspectMode = true;
      console.debug('[StudioBridge] Inspect mode enabled from query param');
    }

    console.debug('[StudioBridge] Initialized successfully');
  }

  init();
})();`;
}
