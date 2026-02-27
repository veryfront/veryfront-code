export interface StudioBridgeOptions {
  projectId: string;
  pageId: string;
  pagePath?: string;
  debugSkipInit?: boolean;
  debugExposeInternals?: boolean;
}

export function generateStudioBridgeScript(options: StudioBridgeOptions): string {
  return `(function() {
  'use strict';

  const PROJECT_ID = ${JSON.stringify(options.projectId)};
  const PAGE_ID = ${JSON.stringify(options.pageId)};
  const PAGE_PATH = ${JSON.stringify(options.pagePath ?? options.pageId)};
  const DEBUG_SKIP_INIT = ${options.debugSkipInit ? "true" : "false"};
  const DEBUG_EXPOSE_INTERNALS = ${options.debugExposeInternals ? "true" : "false"};

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
  let markdownEditorRoot = null;
  let markdownEditorSurface = null;
  let markdownEditorTextarea = null;
  let markdownEditButton = null;
  let markdownFileId = null;
  let markdownSyncTimer = null;
  let markdownSelectionSyncTimer = null;
  let markdownPersistStatus = null;
  let markdownPresenceRoot = null;
  let markdownSelectionsRoot = null;
  let markdownSelectionOverlayRoot = null;
  let markdownOverlaySelections = [];
  let markdownSelectionOverlayRenderFrame = null;
  let markdownSlashMenuRoot = null;
  let markdownSlashMenuTimer = null;
  let markdownSlashMenuContext = null;
  let markdownSlashMenuCommands = [];
  let markdownSlashMenuActiveIndex = 0;
  let markdownInlineToolbarRoot = null;
  let markdownInlineToolbarFrame = null;
  let markdownBlockDragHandle = null;
  let markdownBlockDropIndicator = null;
  let markdownBlockDropLabel = null;
  let markdownBlockDragGhost = null;
  let markdownBlockDragSourceIndex = -1;
  let markdownBlockDropSlotIndex = -1;
  let markdownBlockHandleHoverIndex = -1;
  let markdownBlockDragActive = false;
  let markdownMdxBlocksRoot = null;
  let markdownLexicalApi = null;
  let markdownLexicalSetupPromise = null;
  let markdownCurrentContent = '';
  let markdownCurrentEditorContent = '';
  let markdownLexicalRenderedContent = null;
  let markdownApplyingRemoteUpdate = false;
  let markdownFrontmatter = '';
  let markdownRawBlocks = [];
  let markdownRawBlockTokenPrefix = 'VF_RAW_BLOCK';
  let markdownLatestMdxBlocks = [];
  let markdownLatestMdxImportMap = {};
  let markdownLatestPresenceUsers = [];
  let markdownLatestSelections = [];
  let markdownHasUnsavedChanges = false;
  let markdownSaveInProgress = false;
  let markdownYDoc = null;
  let markdownYProvider = null;
  let markdownYText = null;
  let markdownYjsConnected = false;
  let markdownYjsSetupId = 0;
  let markdownYjsY = null;
  const LEXICAL_YJS_ORIGIN = 'lexical-yjs-binding';

  const MARKDOWN_SLASH_COMMANDS = [
    {
      id: 'heading-1',
      label: 'Heading 1',
      description: 'Create a top-level heading',
      aliases: ['h1', 'heading', 'title']
    },
    {
      id: 'heading-2',
      label: 'Heading 2',
      description: 'Create a second-level heading',
      aliases: ['h2', 'heading2', 'subheading']
    },
    {
      id: 'heading-3',
      label: 'Heading 3',
      description: 'Create a third-level heading',
      aliases: ['h3', 'heading3']
    },
    {
      id: 'bulleted-list',
      label: 'Bulleted list',
      description: 'Start a bullet list item',
      aliases: ['list', 'bullet', 'ul']
    },
    {
      id: 'numbered-list',
      label: 'Numbered list',
      description: 'Start a numbered list item',
      aliases: ['olist', 'numbered', 'ol']
    },
    {
      id: 'quote-block',
      label: 'Quote',
      description: 'Insert a block quote line',
      aliases: ['quote', 'blockquote']
    },
    {
      id: 'code-block',
      label: 'Code block',
      description: 'Insert a fenced code block',
      aliases: ['code', 'fence', 'snippet']
    },
    {
      id: 'image',
      label: 'Image',
      description: 'Insert markdown image syntax',
      aliases: ['image', 'img', 'photo']
    }
  ];

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

      .vf-markdown-edit-button {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 100001;
        border: 1px solid rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        background: #111827;
        color: #ffffff;
        font-size: 13px;
        line-height: 1;
        padding: 10px 12px;
        cursor: pointer;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
      }

      .vf-markdown-editor {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: var(--vf-markdown-editor-bg, #ffffff);
        display: none;
      }

      .vf-markdown-editor__toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
        background: rgba(255, 255, 255, 0.94);
        position: sticky;
        top: 0;
      }

      .vf-markdown-editor__title {
        font-size: 12px;
        color: #374151;
        font-weight: 600;
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
      }

      .vf-markdown-editor__title-main {
        font-size: 12px;
        font-weight: 700;
      }

      .vf-markdown-editor__title-hints {
        font-size: 10px;
        font-weight: 500;
        color: #6b7280;
      }

      .vf-markdown-editor__actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .vf-markdown-editor__status {
        font-size: 12px;
        color: #6b7280;
      }

      .vf-markdown-editor__status[data-state='saving'] {
        color: #b45309;
      }

      .vf-markdown-editor__status[data-state='saved'] {
        color: #15803d;
      }

      .vf-markdown-editor__status[data-state='error'] {
        color: #b91c1c;
      }

      .vf-markdown-editor__presence {
        display: none;
        align-items: center;
        gap: 6px;
      }

      .vf-markdown-editor__presence-pill {
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-left-width: 4px;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        color: #111827;
        background: #ffffff;
      }

      .vf-markdown-editor__presence-pill[data-current='true'] {
        font-weight: 600;
      }

      .vf-markdown-editor__presence-pill[data-agent='true'] {
        font-style: italic;
      }

      .vf-markdown-editor__selections {
        display: none;
        align-items: center;
        gap: 6px;
      }

      .vf-markdown-editor__selection-pill {
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-left-width: 4px;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        color: #111827;
        background: #ffffff;
      }

      .vf-markdown-editor__exit {
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 6px;
        background: #ffffff;
        color: #111827;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
      }

      .vf-markdown-editor__history {
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 6px;
        background: #ffffff;
        color: #111827;
        font-size: 13px;
        line-height: 1;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        cursor: pointer;
      }

      .vf-markdown-editor__surface-wrap {
        position: relative;
        height: calc(100vh - 52px);
      }

      .vf-markdown-editor__surface {
        width: 100%;
        max-width: 980px;
        margin: 0 auto;
        height: 100%;
        overflow: auto;
        outline: none;
        position: relative;
        z-index: 1;
        background: transparent;
        padding: 32px 40px;
        box-sizing: border-box;
      }

      .vf-markdown-editor__selection-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        display: none;
      }

      .vf-markdown-editor__selection-highlight {
        position: absolute;
        border-radius: 3px;
        opacity: 0.26;
      }

      .vf-markdown-editor__selection-caret {
        position: absolute;
        width: 2px;
        border-radius: 1px;
      }

      .vf-markdown-editor__selection-label {
        position: absolute;
        transform: translateY(-100%);
        margin-top: -4px;
        border-radius: 999px;
        padding: 1px 7px;
        font-size: 10px;
        line-height: 1.4;
        white-space: nowrap;
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      }

      .vf-markdown-editor__slash-menu {
        position: fixed;
        z-index: 100005;
        min-width: 220px;
        max-width: 300px;
        border: 1px solid rgba(17, 24, 39, 0.16);
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
        padding: 6px;
        display: none;
      }

      .vf-markdown-editor__slash-item {
        display: block;
        width: 100%;
        border: 0;
        border-radius: 8px;
        background: transparent;
        text-align: left;
        padding: 8px 10px;
        cursor: pointer;
      }

      .vf-markdown-editor__slash-item:hover,
      .vf-markdown-editor__slash-item[data-active='true'] {
        background: rgba(0, 129, 248, 0.12);
      }

      .vf-markdown-editor__slash-item-title {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #111827;
        line-height: 1.35;
      }

      .vf-markdown-editor__slash-item-desc {
        display: block;
        margin-top: 2px;
        font-size: 11px;
        color: #6b7280;
        line-height: 1.35;
      }

      .vf-markdown-editor__inline-toolbar {
        position: fixed;
        z-index: 100006;
        display: none;
        align-items: center;
        gap: 2px;
        border: 1px solid rgba(17, 24, 39, 0.16);
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
        padding: 4px;
      }

      .vf-markdown-editor__inline-button {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #111827;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        min-width: 26px;
        height: 24px;
        padding: 0 7px;
        cursor: pointer;
      }

      .vf-markdown-editor__inline-button:hover {
        background: rgba(0, 129, 248, 0.12);
      }

      .vf-markdown-editor__block-handle {
        position: fixed;
        z-index: 100007;
        display: none;
        border: 1px solid rgba(17, 24, 39, 0.18);
        border-radius: 6px;
        background: #ffffff;
        color: #374151;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        width: 28px;
        height: 28px;
        padding: 0;
        cursor: grab;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
      }

      .vf-markdown-editor__block-handle:hover {
        background: rgba(0, 129, 248, 0.12);
      }

      .vf-markdown-editor__block-handle[data-dragging='true'] {
        cursor: grabbing;
      }

      .vf-markdown-editor__block-drop-indicator {
        position: fixed;
        z-index: 100006;
        display: none;
        height: 2px;
        border-radius: 999px;
        background: #0081f8;
        box-shadow: 0 1px 6px rgba(0, 129, 248, 0.5);
      }

      .vf-markdown-editor__block-drop-label {
        position: fixed;
        z-index: 100007;
        display: none;
        border-radius: 999px;
        border: 1px solid rgba(0, 129, 248, 0.24);
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.2;
        padding: 3px 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
      }

      .vf-markdown-editor__block-drag-ghost {
        position: fixed;
        top: -9999px;
        left: -9999px;
        width: 260px;
        border: 1px solid rgba(17, 24, 39, 0.22);
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
        padding: 8px 10px;
      }

      .vf-markdown-editor__block-drag-ghost-title {
        display: block;
        font-size: 11px;
        font-weight: 700;
        color: #1e293b;
      }

      .vf-markdown-editor__block-drag-ghost-text {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: #475569;
        line-height: 1.35;
      }

      .vf-markdown-editor__mdx-blocks {
        display: none;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(245, 247, 250, 0.95);
        overflow-x: auto;
      }

      .vf-markdown-editor__mdx-block {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 8px;
        background: #ffffff;
        padding: 6px 8px;
      }

      .vf-markdown-editor__mdx-block-label {
        font-size: 11px;
        color: #334155;
        white-space: nowrap;
      }

      .vf-markdown-editor__mdx-note {
        font-size: 10px;
        color: #6b7280;
        white-space: nowrap;
      }

      .vf-markdown-editor__mdx-open {
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 6px;
        background: #ffffff;
        color: #0f172a;
        font-size: 11px;
        line-height: 1;
        padding: 5px 7px;
        cursor: pointer;
        white-space: nowrap;
      }

      .vf-markdown-editor__surface [data-lexical-editor] {
        outline: none;
      }

      .vf-markdown-editor__surface p:empty::before {
        content: '';
        display: inline-block;
      }

      .vf-markdown-editor__surface p {
        min-height: 1.5em;
      }

      .vf-markdown-editor__textarea {
        width: 100%;
        height: calc(100vh - 52px);
        border: 0;
        outline: none;
        resize: none;
        display: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.6;
        color: #111827;
        background: transparent;
        padding: 16px;
        box-sizing: border-box;
      }

      [data-theme='dark'] .vf-markdown-editor {
        --vf-markdown-editor-bg: #0b1220;
      }

      [data-theme='dark'] .vf-markdown-editor__toolbar {
        border-bottom-color: rgba(255, 255, 255, 0.18);
        background: rgba(17, 24, 39, 0.92);
      }

      [data-theme='dark'] .vf-markdown-editor__title {
        color: #d1d5db;
      }

      [data-theme='dark'] .vf-markdown-editor__title-hints {
        color: #9ca3af;
      }

      [data-theme='dark'] .vf-markdown-editor__exit {
        background: #111827;
        border-color: rgba(255, 255, 255, 0.2);
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__history {
        background: #111827;
        border-color: rgba(255, 255, 255, 0.2);
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__status {
        color: #9ca3af;
      }

      [data-theme='dark'] .vf-markdown-editor__status[data-state='saving'] {
        color: #fbbf24;
      }

      [data-theme='dark'] .vf-markdown-editor__status[data-state='saved'] {
        color: #4ade80;
      }

      [data-theme='dark'] .vf-markdown-editor__status[data-state='error'] {
        color: #f87171;
      }

      [data-theme='dark'] .vf-markdown-editor__presence-pill {
        border-color: rgba(255, 255, 255, 0.2);
        color: #f9fafb;
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__selection-pill {
        border-color: rgba(255, 255, 255, 0.2);
        color: #f9fafb;
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__textarea {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-menu {
        border-color: rgba(255, 255, 255, 0.2);
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item:hover,
      [data-theme='dark'] .vf-markdown-editor__slash-item[data-active='true'] {
        background: rgba(59, 130, 246, 0.24);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item-title {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item-desc {
        color: #9ca3af;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-toolbar {
        border-color: rgba(255, 255, 255, 0.2);
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button:hover {
        background: rgba(59, 130, 246, 0.24);
      }

      [data-theme='dark'] .vf-markdown-editor__block-handle {
        border-color: rgba(255, 255, 255, 0.22);
        background: #111827;
        color: #d1d5db;
      }

      [data-theme='dark'] .vf-markdown-editor__block-handle:hover {
        background: rgba(59, 130, 246, 0.24);
      }

      [data-theme='dark'] .vf-markdown-editor__block-drop-label {
        border-color: rgba(59, 130, 246, 0.35);
        background: rgba(17, 24, 39, 0.94);
        color: #e5e7eb;
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost {
        border-color: rgba(255, 255, 255, 0.24);
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost-title {
        color: #e5e7eb;
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost-text {
        color: #94a3b8;
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-blocks {
        border-bottom-color: rgba(255, 255, 255, 0.12);
        background: rgba(2, 6, 23, 0.7);
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-block {
        border-color: rgba(255, 255, 255, 0.22);
        background: #111827;
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-block-label {
        color: #cbd5e1;
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-note {
        color: #94a3b8;
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-open {
        border-color: rgba(255, 255, 255, 0.22);
        background: #0b1220;
        color: #e5e7eb;
      }
    \`;
    try {
      document.head.appendChild(style);
      if (!style.sheet) {
        console.warn('[StudioBridge] Inline style injection may be blocked by CSP (style-src).');
      }
    } catch (error) {
      console.warn('[StudioBridge] Failed to inject bridge styles. This may be caused by CSP style-src restrictions.', error);
    }
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
    try {
      const url = new URL(event.origin || '');
      const host = url.hostname;
      return (
        host === 'localhost' ||
        host.endsWith('.veryfront.org') || host === 'veryfront.org' ||
        host.endsWith('.veryfront.com') || host === 'veryfront.com' ||
        host.endsWith('.veryfront.dev') || host === 'veryfront.dev'
      );
    } catch (e) {
      return false;
    }
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

  function isMarkdownPage() {
    if (typeof PAGE_PATH !== 'string') {
      return false;
    }
    const lowerPath = PAGE_PATH.toLowerCase();
    return lowerPath.endsWith('.md') || lowerPath.endsWith('.mdx');
  }

  function isMdxPage() {
    return typeof PAGE_PATH === 'string' && PAGE_PATH.toLowerCase().endsWith('.mdx');
  }

  function openFilePathInStudio(filePath, lineNumber, symbolName) {
    if (typeof filePath !== 'string' || !filePath) {
      return;
    }
    const safeLine = Number.isFinite(lineNumber) ? Math.max(1, Math.trunc(lineNumber)) : 1;
    const payload = {
      action: 'openFile',
      filePath: filePath,
      lineNumber: safeLine,
      columnNumber: 1
    };
    if (typeof symbolName === 'string' && symbolName.trim()) {
      payload.symbolName = symbolName.trim();
    }
    postToStudio(payload);
  }

  function openMarkdownSourceInStudio(lineNumber) {
    openFilePathInStudio(PAGE_PATH, lineNumber);
  }

  function normalizePathSegments(segments) {
    const stack = [];
    for (const segment of segments) {
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (stack.length > 0) {
          stack.pop();
        }
        continue;
      }
      stack.push(segment);
    }
    return stack;
  }

  function resolveImportPathForPage(importPath) {
    const sourcePath = typeof importPath === 'string' ? importPath.trim() : '';
    if (!sourcePath) {
      return '';
    }

    if (sourcePath.startsWith('@/') || sourcePath.startsWith('~/')) {
      return sourcePath.slice(2);
    }

    if (sourcePath.startsWith('/')) {
      let normalizedPath = sourcePath;
      while (normalizedPath.startsWith('/')) {
        normalizedPath = normalizedPath.slice(1);
      }
      return normalizedPath;
    }

    if (!PAGE_PATH || !sourcePath.startsWith('.')) {
      return sourcePath;
    }

    const baseParts = String(PAGE_PATH).split('/');
    baseParts.pop();
    const resolved = normalizePathSegments(baseParts.concat(sourcePath.split('/')));
    return resolved.join('/');
  }

  function isLikelyProjectImportPath(importPath) {
    if (typeof importPath !== 'string') {
      return false;
    }
    const value = importPath.trim();
    if (!value) {
      return false;
    }
    return (
      value.startsWith('.') ||
      value.startsWith('/') ||
      value.startsWith('@/') ||
      value.startsWith('~/')
    );
  }

  function guessStudioFilePath(filePath) {
    const sourcePath = typeof filePath === 'string' ? filePath.trim() : '';
    if (!sourcePath) {
      return '';
    }

    const hasKnownExtension = sourcePath.match(/\\.(tsx?|jsx?|mdx?|json|css|scss|sass|less)$/i);
    if (hasKnownExtension) {
      return sourcePath;
    }

    if (sourcePath.endsWith('/')) {
      return sourcePath + 'index.tsx';
    }

    return sourcePath + '.tsx';
  }

  function parseMdxImportMap(content) {
    const source = typeof content === 'string' ? content : '';
    const importMap = {};
    if (!source) {
      return importMap;
    }

    const stripImportComments = function(specifierText) {
      return String(specifierText || '')
        .replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')
        .replace(/\\/\\/[^\\n\\r]*/g, ' ');
    };

    const normalizeImportSpecifier = function(specifierText) {
      return stripImportComments(specifierText)
        .replace(/\\s+/g, ' ')
        .trim();
    };

    const setImportEntry = function(localName, resolvedPath, symbolName, importKind) {
      const key = typeof localName === 'string' ? localName.trim() : '';
      const filePath = typeof resolvedPath === 'string' ? resolvedPath.trim() : '';
      if (!key || !filePath) {
        return;
      }
      importMap[key] = {
        filePath: filePath,
        symbolName: typeof symbolName === 'string' ? symbolName.trim() : '',
        importKind: typeof importKind === 'string' ? importKind : 'unknown'
      };
    };

    const mapNamedImports = function(namedSpecifier, resolvedPath) {
      const text = String(namedSpecifier || '').trim();
      if (!text.startsWith('{') || !text.endsWith('}')) {
        return;
      }
      const named = text.slice(1, -1).split(',');
      for (const entry of named) {
        const part = entry.trim();
        if (!part) {
          continue;
        }
        const normalizedPart = normalizeImportSpecifier(part).trim();
        if (!normalizedPart || /^type\\s+/.test(normalizedPart)) {
          continue;
        }
        const aliasMatch = normalizedPart.match(/^([A-Za-z_$][\\w$]*)\\s+as\\s+([A-Za-z_$][\\w$]*)$/);
        const sourceName = aliasMatch ? aliasMatch[1] : normalizedPart;
        const localName = aliasMatch ? aliasMatch[2] : normalizedPart;
        if (localName) {
          const isDefaultAlias = sourceName === 'default';
          setImportEntry(localName, resolvedPath, isDefaultAlias ? '' : sourceName, isDefaultAlias ? 'default' : 'named');
        }
      }
    };

    const importPattern = /^import\\s+([\\s\\S]*?)\\s+from\\s+['\"]([^'\"]+)['\"]\\s*;?/gm;
    let match = importPattern.exec(source);
    while (match) {
      const specifier = normalizeImportSpecifier(match[1] || '');
      if (!specifier) {
        match = importPattern.exec(source);
        continue;
      }
      const typeOnlySpecifier = specifier.startsWith('type ');
      const normalizedSpecifier = typeOnlySpecifier ? specifier.slice(5).trim() : specifier;
      if (typeOnlySpecifier) {
        match = importPattern.exec(source);
        continue;
      }
      const rawImportPath = String(match[2] || '').trim();
      if (!isLikelyProjectImportPath(rawImportPath)) {
        match = importPattern.exec(source);
        continue;
      }
      const resolvedPath = guessStudioFilePath(resolveImportPathForPage(rawImportPath));
      if (!resolvedPath) {
        match = importPattern.exec(source);
        continue;
      }

      if (normalizedSpecifier.startsWith('{') && normalizedSpecifier.endsWith('}')) {
        mapNamedImports(normalizedSpecifier, resolvedPath);
      } else if (normalizedSpecifier.startsWith('* as ')) {
        const namespaceName = normalizedSpecifier.slice(5).trim();
        if (namespaceName) {
          setImportEntry(namespaceName, resolvedPath, '', 'namespace');
        }
      } else {
        const commaIndex = normalizedSpecifier.indexOf(',');
        if (commaIndex >= 0) {
          const defaultPart = normalizedSpecifier.slice(0, commaIndex).trim();
          const restPart = normalizedSpecifier.slice(commaIndex + 1).trim();
          const normalizedDefaultPart = defaultPart.trim();
          if (normalizedDefaultPart && !/^type\\s+/.test(normalizedDefaultPart)) {
            setImportEntry(normalizedDefaultPart, resolvedPath, '', 'default');
          }
          if (restPart.startsWith('{')) {
            mapNamedImports(restPart, resolvedPath);
          } else if (restPart.startsWith('* as ')) {
            const namespaceName = restPart.slice(5).trim();
            if (namespaceName) {
              setImportEntry(namespaceName, resolvedPath, '', 'namespace');
            }
          }
        } else {
          const defaultPart = normalizedSpecifier.trim();
          const normalizedDefaultPart = defaultPart.trim();
          if (normalizedDefaultPart && !/^type\\s+/.test(normalizedDefaultPart)) {
            setImportEntry(normalizedDefaultPart, resolvedPath, '', 'default');
          }
        }
      }

      match = importPattern.exec(source);
    }

    return importMap;
  }

  function postMarkdownEditorReady() {
    if (!markdownFileId) {
      return;
    }
    postToStudio({
      action: 'markdownEditorReady',
      fileId: markdownFileId,
      filePath: PAGE_PATH
    });
  }

  function scheduleMarkdownSync(content) {
    if (!markdownFileId) {
      return;
    }
    if (markdownSyncTimer) {
      clearTimeout(markdownSyncTimer);
    }
    markdownSyncTimer = setTimeout(function() {
      postToStudio({
        action: 'markdownContentChange',
        fileId: markdownFileId,
        filePath: PAGE_PATH,
        content: content
      });
    }, 120);
  }

  function computeTextDiff(oldText, newText) {
    var prefixLen = 0;
    var minLen = Math.min(oldText.length, newText.length);
    while (prefixLen < minLen && oldText.charCodeAt(prefixLen) === newText.charCodeAt(prefixLen)) {
      prefixLen++;
    }
    var suffixLen = 0;
    var maxSuffix = minLen - prefixLen;
    while (suffixLen < maxSuffix &&
           oldText.charCodeAt(oldText.length - 1 - suffixLen) === newText.charCodeAt(newText.length - 1 - suffixLen)) {
      suffixLen++;
    }
    return {
      index: prefixLen,
      deleteCount: oldText.length - prefixLen - suffixLen,
      insertText: newText.slice(prefixLen, suffixLen > 0 ? newText.length - suffixLen : undefined)
    };
  }

  function syncLocalChangeToYText(fullContent) {
    if (!markdownYText || !markdownYDoc) {
      return;
    }
    var currentYContent = markdownYText.toString();
    if (currentYContent === fullContent) {
      return;
    }
    var diff = computeTextDiff(currentYContent, fullContent);
    if (diff.deleteCount === 0 && diff.insertText === '') {
      return;
    }
    markdownYDoc.transact(function() {
      if (diff.deleteCount > 0) {
        markdownYText.delete(diff.index, diff.deleteCount);
      }
      if (diff.insertText) {
        markdownYText.insert(diff.index, diff.insertText);
      }
    }, LEXICAL_YJS_ORIGIN);
  }

  function setupMarkdownYjsConnection(config) {
    if (markdownYDoc) {
      return;
    }

    var setupId = ++markdownYjsSetupId;

    Promise.all([
      import('https://esm.sh/yjs@13.6.28?target=es2022'),
      import('https://esm.sh/y-websocket@2.1.0?deps=yjs@13.6.28&target=es2022')
    ]).then(function(modules) {
      // Abort if edit mode was closed while imports were loading
      if (setupId !== markdownYjsSetupId) {
        return;
      }

      var Y = modules[0];
      var WebsocketProvider = modules[1].WebsocketProvider;
      markdownYjsY = Y;

      var doc = new Y.Doc({ guid: config.guid });
      var provider = new WebsocketProvider(config.wsUrl, config.guid, doc, {
        resyncInterval: -1,
        params: { token: config.authToken }
      });

      var ytext = doc.getText(config.fileId);

      markdownYDoc = doc;
      markdownYProvider = provider;
      markdownYText = ytext;

      // Filter non-binary messages to prevent y-websocket parse errors
      provider.on('status', function(event) {
        console.debug('[StudioBridge] Yjs status:', event.status);
        if (event.status === 'connected' && provider.ws) {
          var origOnMessage = provider.ws.onmessage;
          provider.ws.onmessage = function(wsEvent) {
            if (typeof wsEvent.data === 'string') {
              return;
            }
            if (origOnMessage) {
              origOnMessage.call(provider.ws, wsEvent);
            }
          };
        }
      });

      provider.on('sync', function(synced) {
        if (synced && !markdownYjsConnected) {
          markdownYjsConnected = true;

          var ytextContent = ytext.toString();
          if (markdownCurrentContent && markdownCurrentContent !== ytextContent) {
            // User typed before sync completed — push local edits to Y.Text
            syncLocalChangeToYText(markdownCurrentContent);
          } else if (ytextContent) {
            // No local edits — seed editor from Y.Text
            applyMarkdownContent(ytextContent);
          }

          // Observe Y.Text for remote changes (from other users / Monaco)
          ytext.observe(function(event) {
            if (event.transaction.origin === LEXICAL_YJS_ORIGIN) {
              return;
            }
            var fullContent = ytext.toString();
            if (fullContent === markdownCurrentContent) {
              return;
            }
            applyMarkdownContent(fullContent);
          });

          console.debug('[StudioBridge] Yjs synced, bound to Y.Text for fileId:', config.fileId);
        }
      });
    }).catch(function(error) {
      console.error('[StudioBridge] Failed to setup Yjs connection:', error);
    });
  }

  function disposeMarkdownYjs() {
    markdownYjsSetupId++;
    if (markdownYProvider) {
      markdownYProvider.disconnect();
      markdownYProvider.destroy();
      markdownYProvider = null;
    }
    if (markdownYDoc) {
      markdownYDoc.destroy();
      markdownYDoc = null;
    }
    markdownYText = null;
    markdownYjsConnected = false;
    markdownYjsY = null;
  }

  function getTextOffsetWithinRoot(root, targetNode, targetOffset) {
    if (!root || !targetNode) {
      return 0;
    }

    if (!root.contains(targetNode)) {
      return 0;
    }

    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(targetNode, targetOffset);
      return range.toString().length;
    } catch {
      return 0;
    }
  }

  function getMarkdownEditorSelection() {
    if (markdownLexicalApi && markdownEditorSurface) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return null;
      }

      const range = selection.getRangeAt(0);
      if (
        !markdownEditorSurface.contains(range.startContainer) ||
        !markdownEditorSurface.contains(range.endContainer)
      ) {
        return null;
      }

      const start = getTextOffsetWithinRoot(
        markdownEditorSurface,
        range.startContainer,
        range.startOffset
      );
      const end = getTextOffsetWithinRoot(
        markdownEditorSurface,
        range.endContainer,
        range.endOffset
      );
      return {
        start: Math.max(0, Math.min(start, end)),
        end: Math.max(0, Math.max(start, end))
      };
    }

    if (markdownEditorTextarea) {
      const start = typeof markdownEditorTextarea.selectionStart === 'number'
        ? markdownEditorTextarea.selectionStart
        : 0;
      const end = typeof markdownEditorTextarea.selectionEnd === 'number'
        ? markdownEditorTextarea.selectionEnd
        : start;

      return {
        start: Math.max(0, Math.min(start, end)),
        end: Math.max(0, Math.max(start, end))
      };
    }

    return null;
  }

  function getMarkdownRawBlockLength(index) {
    const rawBlock = markdownRawBlocks[index];
    if (typeof rawBlock !== 'string') {
      return 0;
    }
    return rawBlock.length;
  }

  function escapeRegexText(value) {
    const text = String(value || '');
    let escaped = '';
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if ('\\\\^$.*+?()[]{}|'.indexOf(char) >= 0) {
        escaped += '\\\\' + char;
      } else {
        escaped += char;
      }
    }
    return escaped;
  }

  function getMarkdownRawBlockTokenPattern() {
    const prefix = typeof markdownRawBlockTokenPrefix === 'string' && markdownRawBlockTokenPrefix
      ? markdownRawBlockTokenPrefix
      : 'VF_RAW_BLOCK';
    const escapedPrefix = escapeRegexText(prefix);
    return new RegExp('\\\\[\\\\[' + escapedPrefix + '_(\\\\d+)\\\\]\\\\]', 'g');
  }

  function editorOffsetToBodyOffset(editorOffset, bias) {
    const editorContent = typeof markdownCurrentEditorContent === 'string'
      ? markdownCurrentEditorContent
      : '';
    const maxOffset = editorContent.length;
    const safeOffset = Math.max(0, Math.min(maxOffset, Math.trunc(editorOffset || 0)));
    const tokenPattern = getMarkdownRawBlockTokenPattern();
    let diffBefore = 0;
    let match = tokenPattern.exec(editorContent);

    while (match) {
      const token = match[0];
      const tokenStartEditor = match.index;
      const tokenEndEditor = tokenStartEditor + token.length;
      const rawLength = getMarkdownRawBlockLength(Number(match[1]));
      const tokenDelta = rawLength - token.length;
      const tokenStartBody = tokenStartEditor + diffBefore;

      if (safeOffset >= tokenEndEditor) {
        diffBefore += tokenDelta;
        match = tokenPattern.exec(editorContent);
        continue;
      }

      if (safeOffset > tokenStartEditor) {
        if (bias === 'end') {
          return tokenStartBody + rawLength;
        }
        return tokenStartBody;
      }
      break;
    }

    return safeOffset + diffBefore;
  }

  function bodyOffsetToEditorOffset(bodyOffset, bias) {
    const editorContent = typeof markdownCurrentEditorContent === 'string'
      ? markdownCurrentEditorContent
      : '';
    const safeBodyOffset = Math.max(0, Math.trunc(bodyOffset || 0));
    const tokenPattern = getMarkdownRawBlockTokenPattern();
    let diffBefore = 0;
    let match = tokenPattern.exec(editorContent);

    while (match) {
      const token = match[0];
      const tokenStartEditor = match.index;
      const tokenEndEditor = tokenStartEditor + token.length;
      const rawLength = getMarkdownRawBlockLength(Number(match[1]));
      const tokenStartBody = tokenStartEditor + diffBefore;
      const tokenEndBody = tokenStartBody + rawLength;

      if (safeBodyOffset > tokenEndBody) {
        diffBefore += rawLength - token.length;
        match = tokenPattern.exec(editorContent);
        continue;
      }

      if (safeBodyOffset >= tokenStartBody && safeBodyOffset <= tokenEndBody) {
        if (bias === 'end') {
          return tokenEndEditor;
        }
        return tokenStartEditor;
      }

      const mappedOffset = safeBodyOffset - diffBefore;
      return Math.max(0, Math.min(editorContent.length, mappedOffset));
    }

    const mappedOffset = safeBodyOffset - diffBefore;
    return Math.max(0, Math.min(editorContent.length, mappedOffset));
  }

  function editorOffsetToSourceOffset(editorOffset, bias) {
    const frontmatterLength = typeof markdownFrontmatter === 'string' ? markdownFrontmatter.length : 0;
    const bodyOffset = editorOffsetToBodyOffset(editorOffset, bias);
    return Math.max(0, frontmatterLength + bodyOffset);
  }

  function sourceSelectionToEditorRange(start, end) {
    const frontmatterLength = typeof markdownFrontmatter === 'string' ? markdownFrontmatter.length : 0;
    const safeStart = Math.max(0, Math.trunc(start || 0));
    const safeEnd = Math.max(0, Math.trunc(end || 0));
    const sourceStart = Math.min(safeStart, safeEnd);
    const sourceEnd = Math.max(safeStart, safeEnd);

    if (sourceEnd <= frontmatterLength) {
      return null;
    }

    const bodyStart = Math.max(0, sourceStart - frontmatterLength);
    const bodyEnd = Math.max(0, sourceEnd - frontmatterLength);
    const editorStart = bodyOffsetToEditorOffset(bodyStart, 'start');
    const editorEnd = bodyOffsetToEditorOffset(bodyEnd, 'end');

    return {
      start: Math.max(0, Math.min(editorStart, editorEnd)),
      end: Math.max(0, Math.max(editorStart, editorEnd))
    };
  }

  function setMarkdownEditorSelection(start, end) {
    const safeStart = Math.max(0, Math.trunc(start || 0));
    const endValue = typeof end === 'number' ? end : safeStart;
    const safeEnd = Math.max(0, Math.trunc(endValue));

    if (markdownLexicalApi && markdownEditorSurface) {
      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const anchor = resolveMarkdownTextPoint(markdownEditorSurface, safeStart);
      const focus = resolveMarkdownTextPoint(markdownEditorSurface, safeEnd);
      try {
        const range = document.createRange();
        range.setStart(anchor.node, anchor.offset);
        range.setEnd(focus.node, focus.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // Ignore when point resolution races with Lexical DOM updates.
      }
      return;
    }

    if (markdownEditorTextarea) {
      const max = markdownEditorTextarea.value.length;
      markdownEditorTextarea.setSelectionRange(Math.min(safeStart, max), Math.min(safeEnd, max));
    }
  }

  function hideMarkdownSlashMenu() {
    markdownSlashMenuContext = null;
    markdownSlashMenuCommands = [];
    markdownSlashMenuActiveIndex = 0;
    if (!markdownSlashMenuRoot) {
      return;
    }
    markdownSlashMenuRoot.style.display = 'none';
    markdownSlashMenuRoot.textContent = '';
  }

  function getMarkdownSlashCommandInsert(id, indent) {
    const prefix = typeof indent === 'string' ? indent : '';
    if (id === 'heading-1') {
      const text = prefix + '# ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'heading-2') {
      const text = prefix + '## ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'heading-3') {
      const text = prefix + '### ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'bulleted-list') {
      const text = prefix + '- ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'numbered-list') {
      const text = prefix + '1. ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'quote-block') {
      const text = prefix + '> ';
      return { text: text, caretOffset: text.length };
    }
    if (id === 'code-block') {
      const fence = String.fromCharCode(96, 96, 96);
      const text = prefix + fence + '\\n' + prefix + '\\n' + prefix + fence;
      return {
        text: text,
        caretOffset: (prefix + fence + '\\n' + prefix).length
      };
    }
    if (id === 'image') {
      const text = prefix + '![alt text](https://)';
      return {
        text: text,
        caretOffset: (prefix + '![alt text](').length
      };
    }
    return null;
  }

  function applyMarkdownSlashCommand(index) {
    if (!markdownSlashMenuContext || markdownSlashMenuCommands.length === 0) {
      return false;
    }

    const command = markdownSlashMenuCommands[index];
    if (!command) {
      return false;
    }

    const insert = getMarkdownSlashCommandInsert(command.id, markdownSlashMenuContext.indent);
    if (!insert) {
      return false;
    }

    const editorContent = typeof markdownCurrentEditorContent === 'string'
      ? markdownCurrentEditorContent
      : '';
    const before = editorContent.slice(0, markdownSlashMenuContext.lineStart);
    const after = editorContent.slice(markdownSlashMenuContext.caret);
    const nextEditorContent = before + insert.text + after;
    const nextCaret = before.length + insert.caretOffset;
    const nextFullContent = composeMarkdownContent(restoreRawBlocksFromEditor(nextEditorContent));
    const hasChanged = nextFullContent !== markdownCurrentContent;

    applyMarkdownContent(nextFullContent);
    if (hasChanged) {
      markdownHasUnsavedChanges = true;
      scheduleMarkdownSync(nextFullContent);
    }

    setTimeout(function() {
      focusMarkdownEditor();
      setMarkdownEditorSelection(nextCaret, nextCaret);
      scheduleMarkdownSelectionSync();
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
    }, 0);

    hideMarkdownSlashMenu();
    return true;
  }

  function renderMarkdownSlashMenu() {
    if (!markdownSlashMenuRoot || !markdownSlashMenuContext || markdownSlashMenuCommands.length === 0) {
      hideMarkdownSlashMenu();
      return;
    }

    markdownSlashMenuRoot.textContent = '';

    const maxLeft = Math.max(8, window.innerWidth - 312);
    const maxTop = Math.max(8, window.innerHeight - 220);
    const left = Math.max(8, Math.min(maxLeft, markdownSlashMenuContext.anchorLeft));
    const top = Math.max(8, Math.min(maxTop, markdownSlashMenuContext.anchorTop));
    markdownSlashMenuRoot.style.left = left + 'px';
    markdownSlashMenuRoot.style.top = top + 'px';

    markdownSlashMenuCommands.forEach(function(command, index) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vf-markdown-editor__slash-item';
      item.setAttribute('data-active', index === markdownSlashMenuActiveIndex ? 'true' : 'false');
      item.setAttribute(DATA_VF_IGNORE, 'true');
      item.addEventListener('mousedown', function(event) {
        event.preventDefault();
      });
      item.addEventListener('click', function(event) {
        event.preventDefault();
        markdownSlashMenuActiveIndex = index;
        applyMarkdownSlashCommand(markdownSlashMenuActiveIndex);
      });

      const title = document.createElement('span');
      title.className = 'vf-markdown-editor__slash-item-title';
      title.textContent = command.label;

      const description = document.createElement('span');
      description.className = 'vf-markdown-editor__slash-item-desc';
      description.textContent = command.description;

      item.appendChild(title);
      item.appendChild(description);
      markdownSlashMenuRoot.appendChild(item);
    });

    markdownSlashMenuRoot.style.display = 'block';
  }

  function updateMarkdownSlashMenu() {
    if (
      !markdownEditorRoot ||
      markdownEditorRoot.style.display !== 'block' ||
      !markdownLexicalApi ||
      !markdownEditorSurface ||
      markdownEditorSurface.style.display === 'none'
    ) {
      hideMarkdownSlashMenu();
      return;
    }

    const selection = getMarkdownEditorSelection();
    if (!selection || selection.start !== selection.end) {
      hideMarkdownSlashMenu();
      return;
    }

    const caret = selection.start;
    const editorContent = typeof markdownCurrentEditorContent === 'string'
      ? markdownCurrentEditorContent
      : '';
    const lineStart = editorContent.lastIndexOf('\\n', Math.max(0, caret - 1)) + 1;
    const line = editorContent.slice(lineStart, caret);
    const match = line.match(/^(\\s*)\\/([a-z0-9-]*)$/i);
    if (!match) {
      hideMarkdownSlashMenu();
      return;
    }

    const query = (match[2] || '').toLowerCase();
    const commands = MARKDOWN_SLASH_COMMANDS.filter(function(command) {
      if (!query) {
        return true;
      }
      if (command.label.toLowerCase().includes(query)) {
        return true;
      }
      return command.aliases.some(function(alias) {
        return alias.startsWith(query);
      });
    });

    if (commands.length === 0) {
      hideMarkdownSlashMenu();
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      hideMarkdownSlashMenu();
      return;
    }
    const caretRect = domSelection.getRangeAt(0).getBoundingClientRect();
    const anchorLeft = caretRect.left;
    const anchorTop = caretRect.bottom + 8;

    markdownSlashMenuCommands = commands.slice(0, 8);
    markdownSlashMenuActiveIndex = Math.max(0, Math.min(markdownSlashMenuActiveIndex, markdownSlashMenuCommands.length - 1));
    markdownSlashMenuContext = {
      lineStart: lineStart,
      caret: caret,
      indent: match[1] || '',
      query: query,
      anchorLeft: anchorLeft,
      anchorTop: anchorTop
    };
    renderMarkdownSlashMenu();
  }

  function scheduleMarkdownSlashMenuUpdate() {
    if (markdownSlashMenuTimer) {
      clearTimeout(markdownSlashMenuTimer);
    }
    markdownSlashMenuTimer = setTimeout(function() {
      markdownSlashMenuTimer = null;
      updateMarkdownSlashMenu();
    }, 0);
  }

  function handleMarkdownSlashMenuKeydown(event) {
    if (!markdownSlashMenuRoot || markdownSlashMenuRoot.style.display !== 'block' || markdownSlashMenuCommands.length === 0) {
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      markdownSlashMenuActiveIndex = (markdownSlashMenuActiveIndex + 1) % markdownSlashMenuCommands.length;
      renderMarkdownSlashMenu();
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      markdownSlashMenuActiveIndex = (markdownSlashMenuActiveIndex - 1 + markdownSlashMenuCommands.length) % markdownSlashMenuCommands.length;
      renderMarkdownSlashMenu();
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      return applyMarkdownSlashCommand(markdownSlashMenuActiveIndex);
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      hideMarkdownSlashMenu();
      return true;
    }

    return false;
  }

  function hideMarkdownInlineToolbar() {
    if (!markdownInlineToolbarRoot) {
      return;
    }
    markdownInlineToolbarRoot.style.display = 'none';
  }

  function toggleMarkdownInlineFormat(format) {
    if (!markdownLexicalApi || !markdownLexicalApi.editor || !markdownLexicalApi.lexicalModule) {
      return;
    }
    if (typeof format !== 'string' || !format) {
      return;
    }

    markdownLexicalApi.editor.focus();
    markdownLexicalApi.editor.dispatchCommand(markdownLexicalApi.lexicalModule.FORMAT_TEXT_COMMAND, format);
    scheduleMarkdownInlineToolbarUpdate();
  }

  function updateMarkdownInlineToolbar() {
    if (
      !markdownInlineToolbarRoot ||
      !markdownEditorRoot ||
      markdownEditorRoot.style.display !== 'block' ||
      !markdownLexicalApi ||
      !markdownEditorSurface ||
      markdownEditorSurface.style.display === 'none'
    ) {
      hideMarkdownInlineToolbar();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideMarkdownInlineToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    if (
      !markdownEditorSurface.contains(range.startContainer) ||
      !markdownEditorSurface.contains(range.endContainer)
    ) {
      hideMarkdownInlineToolbar();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hideMarkdownInlineToolbar();
      return;
    }

    const left = Math.max(8, Math.min(window.innerWidth - 180, rect.left + rect.width / 2 - 66));
    const top = Math.max(8, Math.min(window.innerHeight - 56, rect.top - 44));
    markdownInlineToolbarRoot.style.left = left + 'px';
    markdownInlineToolbarRoot.style.top = top + 'px';
    markdownInlineToolbarRoot.style.display = 'inline-flex';
  }

  function scheduleMarkdownInlineToolbarUpdate() {
    if (markdownInlineToolbarFrame) {
      cancelAnimationFrame(markdownInlineToolbarFrame);
    }

    markdownInlineToolbarFrame = requestAnimationFrame(function() {
      markdownInlineToolbarFrame = null;
      updateMarkdownInlineToolbar();
    });
  }

  function getMarkdownTopLevelBlocks() {
    if (!markdownEditorSurface) {
      return [];
    }

    return Array.from(markdownEditorSurface.children).filter(function(node) {
      return node && node.nodeType === Node.ELEMENT_NODE;
    });
  }

  function hideMarkdownBlockDragHandle() {
    markdownBlockHandleHoverIndex = -1;
    if (!markdownBlockDragHandle) {
      return;
    }
    markdownBlockDragHandle.style.display = 'none';
    markdownBlockDragHandle.removeAttribute('data-block-index');
  }

  function hideMarkdownBlockDropIndicator() {
    markdownBlockDropSlotIndex = -1;
    if (markdownBlockDropIndicator) {
      markdownBlockDropIndicator.style.display = 'none';
    }
    if (markdownBlockDropLabel) {
      markdownBlockDropLabel.style.display = 'none';
      markdownBlockDropLabel.textContent = '';
    }
  }

  function hideMarkdownBlockDragUi() {
    markdownBlockDragActive = false;
    markdownBlockDragSourceIndex = -1;
    if (markdownBlockDragHandle) {
      markdownBlockDragHandle.setAttribute('data-dragging', 'false');
    }
    removeMarkdownDragGhost();
    hideMarkdownBlockDropIndicator();
    hideMarkdownBlockDragHandle();
  }

  function getMarkdownBlockElementFromNode(node) {
    if (!markdownEditorSurface || !node) {
      return null;
    }

    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (current && current.parentElement !== markdownEditorSurface) {
      current = current.parentElement;
    }

    if (!current || current.parentElement !== markdownEditorSurface) {
      return null;
    }
    return current;
  }

  function getMarkdownBlockTypeInfo(block) {
    if (!block || !block.tagName) {
      return { label: 'block', color: '#0081f8' };
    }

    const tag = block.tagName.toLowerCase();
    if (tag === 'h1') {
      return { label: 'heading 1', color: '#7c3aed' };
    }
    if (tag === 'h2') {
      return { label: 'heading 2', color: '#7c3aed' };
    }
    if (tag === 'h3') {
      return { label: 'heading 3', color: '#7c3aed' };
    }
    if (tag === 'ul' || tag === 'ol') {
      return { label: 'list', color: '#0d9488' };
    }
    if (tag === 'blockquote') {
      return { label: 'quote', color: '#2563eb' };
    }
    if (tag === 'pre') {
      return { label: 'code block', color: '#ea580c' };
    }
    if (tag === 'img' || tag === 'figure') {
      return { label: 'image', color: '#db2777' };
    }
    if (tag === 'p') {
      return { label: 'paragraph', color: '#16a34a' };
    }
    return { label: tag, color: '#0081f8' };
  }

  function getMarkdownBlockPreviewText(block) {
    if (!block) {
      return '';
    }
    const text = String(block.textContent || '').replace(new RegExp('\\s+', 'g'), ' ').trim();
    if (!text) {
      return 'Empty block';
    }
    if (text.length > 84) {
      return text.slice(0, 84) + '...';
    }
    return text;
  }

  function removeMarkdownDragGhost() {
    if (!markdownBlockDragGhost) {
      return;
    }
    markdownBlockDragGhost.remove();
    markdownBlockDragGhost = null;
  }

  function createMarkdownDragGhost(block) {
    const typeInfo = getMarkdownBlockTypeInfo(block);
    const ghost = document.createElement('div');
    ghost.className = 'vf-markdown-editor__block-drag-ghost';
    ghost.setAttribute(DATA_VF_IGNORE, 'true');

    const title = document.createElement('span');
    title.className = 'vf-markdown-editor__block-drag-ghost-title';
    title.setAttribute(DATA_VF_IGNORE, 'true');
    title.textContent = 'Moving ' + typeInfo.label;

    const text = document.createElement('span');
    text.className = 'vf-markdown-editor__block-drag-ghost-text';
    text.setAttribute(DATA_VF_IGNORE, 'true');
    text.textContent = getMarkdownBlockPreviewText(block);

    ghost.appendChild(title);
    ghost.appendChild(text);
    return ghost;
  }

  function getLineNumberForOffset(text, offset) {
    const source = typeof text === 'string' ? text : '';
    const maxOffset = Math.max(0, Math.min(source.length, Math.trunc(offset || 0)));
    let line = 1;
    for (let i = 0; i < maxOffset; i += 1) {
      if (source.charCodeAt(i) === 10) {
        line += 1;
      }
    }
    return line;
  }

  function getMdxComponentName(blockText) {
    const source = typeof blockText === 'string' ? blockText : '';
    const fence = String.fromCharCode(96, 96, 96);
    const componentMatch = source.match(/<\\s*([A-Z][\\w.]*)/);
    if (componentMatch && componentMatch[1]) {
      return componentMatch[1];
    }
    if (source.trim().startsWith(fence + 'tsx')) {
      return 'tsx block';
    }
    if (source.trim().startsWith(fence + 'jsx')) {
      return 'jsx block';
    }
    return 'component block';
  }

  function getMdxBlockOpenUiState(block) {
    const hasResolvedTarget = !!(block && typeof block.filePath === 'string' && block.filePath.trim());
    return {
      hasResolvedTarget: hasResolvedTarget,
      buttonLabel: hasResolvedTarget ? 'Edit in Studio' : 'Open MDX source',
      showUnresolvedNote: !hasResolvedTarget
    };
  }

  function setMarkdownMdxBlocks(blocks) {
    markdownLatestMdxBlocks = Array.isArray(blocks) ? blocks : [];
    if (!markdownMdxBlocksRoot) {
      return;
    }

    markdownMdxBlocksRoot.textContent = '';
    if (!isMdxPage() || markdownLatestMdxBlocks.length === 0) {
      markdownMdxBlocksRoot.style.display = 'none';
      return;
    }

    markdownMdxBlocksRoot.style.display = 'flex';
    for (const block of markdownLatestMdxBlocks.slice(0, 8)) {
      if (!block || typeof block.label !== 'string') {
        continue;
      }

      const item = document.createElement('div');
      item.className = 'vf-markdown-editor__mdx-block';
      item.setAttribute(DATA_VF_IGNORE, 'true');

      const label = document.createElement('div');
      label.className = 'vf-markdown-editor__mdx-block-label';
      label.setAttribute(DATA_VF_IGNORE, 'true');
      const safeLine = Number.isFinite(block.lineNumber) ? Math.max(1, Math.trunc(block.lineNumber)) : 1;
      label.textContent = block.label + ' (line ' + String(safeLine) + ')';
      const openUiState = getMdxBlockOpenUiState(block);

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'vf-markdown-editor__mdx-open';
      openButton.setAttribute(DATA_VF_IGNORE, 'true');
      openButton.textContent = openUiState.buttonLabel;
      if (openUiState.showUnresolvedNote) {
        openButton.title = 'Component import could not be resolved. Opening current MDX source.';
      }
      openButton.addEventListener('click', function() {
        const targetFile = typeof block.filePath === 'string' && block.filePath ? block.filePath : PAGE_PATH;
        const targetLine = targetFile === PAGE_PATH ? safeLine : 1;
        const targetSymbol = targetFile === PAGE_PATH
          ? ''
          : (typeof block.symbolName === 'string' ? block.symbolName : '');
        openFilePathInStudio(targetFile, targetLine, targetSymbol);
      });

      item.appendChild(label);
      if (openUiState.showUnresolvedNote) {
        const fallbackNote = document.createElement('span');
        fallbackNote.className = 'vf-markdown-editor__mdx-note';
        fallbackNote.setAttribute(DATA_VF_IGNORE, 'true');
        fallbackNote.textContent = 'Unresolved import';
        item.appendChild(fallbackNote);
      }
      item.appendChild(openButton);
      markdownMdxBlocksRoot.appendChild(item);
    }

    if (markdownMdxBlocksRoot.childNodes.length === 0) {
      markdownMdxBlocksRoot.style.display = 'none';
    }
  }

  function getMarkdownBlockHoverIndexFromPointer(targetNode, clientX, clientY) {
    const blocks = getMarkdownTopLevelBlocks();
    if (blocks.length === 0) {
      return -1;
    }

    const directBlock = getMarkdownBlockElementFromNode(targetNode);
    const directIndex = blocks.indexOf(directBlock);
    if (directIndex >= 0) {
      return directIndex;
    }

    if (!markdownEditorSurface) {
      return -1;
    }
    const surfaceRect = markdownEditorSurface.getBoundingClientRect();
    const leftBoundary = surfaceRect.left - 44;
    const rightBoundary = surfaceRect.left + Math.min(96, surfaceRect.width * 0.35);
    if (clientX < leftBoundary || clientX > rightBoundary) {
      return -1;
    }

    for (let i = 0; i < blocks.length; i += 1) {
      const rect = blocks[i].getBoundingClientRect();
      if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
        return i;
      }
    }

    const firstRect = blocks[0].getBoundingClientRect();
    const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
    if (clientY < firstRect.top) {
      return 0;
    }
    if (clientY > lastRect.bottom) {
      return blocks.length - 1;
    }
    return -1;
  }

  function positionMarkdownBlockDragHandle(block, index) {
    if (!markdownBlockDragHandle || !block || !markdownEditorRoot || markdownEditorRoot.style.display !== 'block') {
      hideMarkdownBlockDragHandle();
      return;
    }

    const rect = block.getBoundingClientRect();
    const surfaceRect = markdownEditorSurface ? markdownEditorSurface.getBoundingClientRect() : null;
    if (!surfaceRect || rect.width <= 0 || rect.height <= 0) {
      hideMarkdownBlockDragHandle();
      return;
    }

    // Ignore blocks outside the visible scroll viewport.
    if (rect.bottom < surfaceRect.top || rect.top > surfaceRect.bottom) {
      hideMarkdownBlockDragHandle();
      return;
    }

    const left = Math.max(6, rect.left - 36);
    const top = Math.max(6, rect.top + 1);
    markdownBlockDragHandle.style.left = left + 'px';
    markdownBlockDragHandle.style.top = top + 'px';
    markdownBlockDragHandle.style.display = 'block';
    markdownBlockDragHandle.setAttribute('data-block-index', String(index));
    markdownBlockHandleHoverIndex = index;
  }

  function refreshMarkdownBlockDragHandlePosition() {
    if (markdownBlockDragActive || markdownBlockHandleHoverIndex < 0) {
      return;
    }
    const blocks = getMarkdownTopLevelBlocks();
    const block = blocks[markdownBlockHandleHoverIndex];
    if (!block) {
      hideMarkdownBlockDragHandle();
      return;
    }
    positionMarkdownBlockDragHandle(block, markdownBlockHandleHoverIndex);
  }

  function getMarkdownDropSlotIndexFromPointer(clientY) {
    const blocks = getMarkdownTopLevelBlocks();
    if (blocks.length === 0) {
      return -1;
    }

    for (let i = 0; i < blocks.length; i += 1) {
      const rect = blocks[i].getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) {
        return i;
      }
    }
    return blocks.length;
  }

  function autoScrollMarkdownSurfaceDuringDrag(clientY) {
    if (!markdownEditorSurface) {
      return;
    }

    const rect = markdownEditorSurface.getBoundingClientRect();
    const threshold = 42;
    const maxStep = 20;
    let delta = 0;

    if (clientY < rect.top + threshold) {
      const distance = rect.top + threshold - clientY;
      delta = -Math.min(maxStep, Math.max(2, Math.floor(distance / 3)));
    } else if (clientY > rect.bottom - threshold) {
      const distance = clientY - (rect.bottom - threshold);
      delta = Math.min(maxStep, Math.max(2, Math.floor(distance / 3)));
    }

    if (delta !== 0) {
      markdownEditorSurface.scrollTop += delta;
      refreshMarkdownBlockDragHandlePosition();
    }
  }

  function showMarkdownBlockDropIndicator(slotIndex) {
    if (!markdownBlockDropIndicator || !markdownEditorSurface) {
      return;
    }

    const blocks = getMarkdownTopLevelBlocks();
    if (blocks.length === 0) {
      hideMarkdownBlockDropIndicator();
      return;
    }

    const safeSlot = Math.max(0, Math.min(blocks.length, Math.trunc(slotIndex || 0)));
    const surfaceRect = markdownEditorSurface.getBoundingClientRect();
    let top = surfaceRect.top + 6;

    if (safeSlot >= blocks.length) {
      const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
      top = lastRect.bottom + 1;
    } else {
      const rect = blocks[safeSlot].getBoundingClientRect();
      top = rect.top - 1;
    }

    markdownBlockDropIndicator.style.left = Math.max(8, surfaceRect.left + 8) + 'px';
    markdownBlockDropIndicator.style.top = Math.max(8, top) + 'px';
    markdownBlockDropIndicator.style.width = Math.max(40, surfaceRect.width - 16) + 'px';
    markdownBlockDropIndicator.style.display = 'block';
    markdownBlockDropSlotIndex = safeSlot;

    const dropType = safeSlot >= blocks.length
      ? { label: 'end of document', color: '#0284c7' }
      : getMarkdownBlockTypeInfo(blocks[safeSlot]);
    markdownBlockDropIndicator.style.background = dropType.color;
    markdownBlockDropIndicator.style.boxShadow = '0 1px 6px ' + dropType.color;

    if (markdownBlockDropLabel) {
      markdownBlockDropLabel.textContent = safeSlot >= blocks.length
        ? 'Drop at end'
        : 'Drop before ' + dropType.label;
      markdownBlockDropLabel.style.left = Math.max(8, surfaceRect.left + 8) + 'px';
      markdownBlockDropLabel.style.top = Math.max(8, top - 26) + 'px';
      markdownBlockDropLabel.style.borderColor = dropType.color;
      markdownBlockDropLabel.style.display = 'block';
    }
  }

  function moveMarkdownLexicalBlock(sourceIndex, targetSlotIndex) {
    if (!markdownLexicalApi || !markdownLexicalApi.editor || !markdownLexicalApi.lexicalModule) {
      return false;
    }

    const source = Math.trunc(sourceIndex);
    const targetSlot = Math.trunc(targetSlotIndex);
    if (!Number.isInteger(source) || !Number.isInteger(targetSlot)) {
      return false;
    }

    let didMove = false;
    markdownLexicalApi.editor.update(function() {
      const root = markdownLexicalApi.lexicalModule.$getRoot();
      const children = root.getChildren();
      const maxSlot = children.length;
      if (source < 0 || source >= maxSlot || targetSlot < 0 || targetSlot > maxSlot) {
        return;
      }

      let adjustedSlot = targetSlot;
      if (source < adjustedSlot) {
        adjustedSlot -= 1;
      }
      if (adjustedSlot === source) {
        return;
      }

      const node = children[source];
      node.remove();
      const afterRemoval = root.getChildren();
      if (adjustedSlot >= afterRemoval.length) {
        root.append(node);
      } else {
        afterRemoval[adjustedSlot].insertBefore(node);
      }
      didMove = true;
    });

    if (didMove) {
      scheduleMarkdownSelectionSync();
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
    }
    return didMove;
  }

  function getMarkdownCurrentBlockIndexFromSelection() {
    if (!markdownEditorSurface) {
      return -1;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return -1;
    }

    const range = selection.getRangeAt(0);
    if (!markdownEditorSurface.contains(range.startContainer)) {
      return -1;
    }

    const block = getMarkdownBlockElementFromNode(range.startContainer);
    if (!block) {
      return -1;
    }

    const blocks = getMarkdownTopLevelBlocks();
    return blocks.indexOf(block);
  }

  function moveMarkdownCurrentBlockByDelta(delta) {
    const blocks = getMarkdownTopLevelBlocks();
    if (blocks.length <= 1) {
      return false;
    }

    const index = getMarkdownCurrentBlockIndexFromSelection();
    if (index < 0) {
      return false;
    }

    const step = Math.sign(delta);
    if (step === 0) {
      return false;
    }

    let targetSlot = index;
    if (step < 0) {
      targetSlot = Math.max(0, index - 1);
    } else {
      targetSlot = Math.min(blocks.length, index + 2);
    }

    const moved = moveMarkdownLexicalBlock(index, targetSlot);
    if (moved) {
      setTimeout(function() {
        const nextBlocks = getMarkdownTopLevelBlocks();
        const nextIndex = Math.max(0, Math.min(nextBlocks.length - 1, index + step));
        const nextBlock = nextBlocks[nextIndex];
        if (nextBlock) {
          positionMarkdownBlockDragHandle(nextBlock, nextIndex);
        }
      }, 0);
    }
    return moved;
  }

  function scheduleMarkdownSelectionSync() {
    if (!markdownFileId) {
      return;
    }

    if (markdownSelectionSyncTimer) {
      clearTimeout(markdownSelectionSyncTimer);
    }

    markdownSelectionSyncTimer = setTimeout(function() {
      const selection = getMarkdownEditorSelection();
      if (!selection) {
        return;
      }

      const start = editorOffsetToSourceOffset(selection.start, 'start');
      const end = editorOffsetToSourceOffset(selection.end, 'end');

      var message = {
        action: 'markdownSelectionChange',
        fileId: markdownFileId,
        filePath: PAGE_PATH,
        start: start,
        end: end
      };

      // When Yjs is connected, include pre-computed RelativePositions
      // from the bridge's Y.Text (which is up-to-date) so Studio doesn't
      // need to compute against potentially stale Y.Text
      if (markdownYjsConnected && markdownYText && markdownYjsY) {
        var clampedStart = Math.max(0, Math.min(markdownYText.length, start));
        var clampedEnd = Math.max(0, Math.min(markdownYText.length, end));
        message.relativeStart = markdownYjsY.relativePositionToJSON(
          markdownYjsY.createRelativePositionFromTypeIndex(markdownYText, clampedStart)
        );
        message.relativeEnd = markdownYjsY.relativePositionToJSON(
          markdownYjsY.createRelativePositionFromTypeIndex(markdownYText, clampedEnd)
        );
      }

      postToStudio(message);
    }, 80);
  }

  function clearMarkdownSelectionSync() {
    if (!markdownFileId) {
      return;
    }
    postToStudio({
      action: 'markdownSelectionChange',
      fileId: markdownFileId,
      filePath: PAGE_PATH,
      start: -1,
      end: -1
    });
  }

  function clearMarkdownSelectionOverlay() {
    if (!markdownSelectionOverlayRoot) {
      return;
    }
    markdownSelectionOverlayRoot.textContent = '';
    markdownSelectionOverlayRoot.style.display = 'none';
  }

  function resolveMarkdownTextPoint(root, rawOffset) {
    const offset = Math.max(0, Math.trunc(rawOffset || 0));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let lastTextNode = null;
    let node = walker.nextNode();

    while (node) {
      lastTextNode = node;
      const textLength = node.textContent ? node.textContent.length : 0;
      if (remaining <= textLength) {
        return { node: node, offset: remaining };
      }
      remaining -= textLength;
      node = walker.nextNode();
    }

    if (lastTextNode) {
      const textLength = lastTextNode.textContent ? lastTextNode.textContent.length : 0;
      return { node: lastTextNode, offset: textLength };
    }

    return {
      node: root,
      offset: offset > 0 ? root.childNodes.length : 0
    };
  }

  function createMarkdownEditorRange(start, end) {
    if (!markdownEditorSurface) {
      return null;
    }

    const safeStart = Math.max(0, Math.min(start, end));
    const safeEnd = Math.max(0, Math.max(start, end));
    const startPoint = resolveMarkdownTextPoint(markdownEditorSurface, safeStart);
    const endPoint = resolveMarkdownTextPoint(markdownEditorSurface, safeEnd);

    try {
      const range = document.createRange();
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      return range;
    } catch {
      return null;
    }
  }

  function toMarkdownOverlayRect(rect, surfaceRect) {
    const rawLeft = rect.left - surfaceRect.left;
    const rawTop = rect.top - surfaceRect.top;
    const rawRight = rawLeft + rect.width;
    const rawBottom = rawTop + rect.height;

    const left = Math.max(0, rawLeft);
    const top = Math.max(0, rawTop);
    const right = Math.min(surfaceRect.width, rawRight);
    const bottom = Math.min(surfaceRect.height, rawBottom);
    const width = right - left;
    const height = bottom - top;

    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      left: left,
      top: top,
      width: width,
      height: height
    };
  }

  function renderMarkdownSelectionOverlay() {
    if (!markdownSelectionOverlayRoot) {
      return;
    }

    if (
      !markdownEditorRoot ||
      markdownEditorRoot.style.display !== 'block' ||
      !markdownEditorSurface ||
      !markdownLexicalApi ||
      !Array.isArray(markdownOverlaySelections) ||
      markdownOverlaySelections.length === 0
    ) {
      clearMarkdownSelectionOverlay();
      return;
    }

    const surfaceRect = markdownEditorSurface.getBoundingClientRect();
    if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
      clearMarkdownSelectionOverlay();
      return;
    }

    const computedStyle = window.getComputedStyle(markdownEditorSurface);
    const lineHeight = Math.max(14, Number.parseFloat(computedStyle.lineHeight || '0') || 22);
    markdownSelectionOverlayRoot.textContent = '';
    markdownSelectionOverlayRoot.style.display = 'block';

    for (const selection of markdownOverlaySelections) {
      if (!selection || typeof selection.start !== 'number' || typeof selection.end !== 'number') {
        continue;
      }

      const range = createMarkdownEditorRange(selection.start, selection.end);
      if (!range) {
        continue;
      }

      const color = typeof selection.color === 'string' && selection.color ? selection.color : '#6b7280';
      const name = typeof selection.name === 'string' && selection.name ? selection.name : 'Anonymous';
      let labelAnchor = null;

      if (selection.start === selection.end) {
        const caretRect = range.getBoundingClientRect();
        const clippedCaret = toMarkdownOverlayRect(
          {
            left: caretRect.left,
            top: caretRect.top,
            width: 2,
            height: Math.max(caretRect.height, lineHeight)
          },
          surfaceRect
        );

        if (!clippedCaret) {
          continue;
        }

        const caret = document.createElement('div');
        caret.className = 'vf-markdown-editor__selection-caret';
        caret.setAttribute(DATA_VF_IGNORE, 'true');
        caret.style.left = clippedCaret.left + 'px';
        caret.style.top = clippedCaret.top + 'px';
        caret.style.height = clippedCaret.height + 'px';
        caret.style.background = color;
        markdownSelectionOverlayRoot.appendChild(caret);

        labelAnchor = { left: clippedCaret.left, top: clippedCaret.top };
      } else {
        const rectList = Array.from(range.getClientRects());
        for (const rect of rectList) {
          const clippedRect = toMarkdownOverlayRect(rect, surfaceRect);
          if (!clippedRect) {
            continue;
          }

          const highlight = document.createElement('div');
          highlight.className = 'vf-markdown-editor__selection-highlight';
          highlight.setAttribute(DATA_VF_IGNORE, 'true');
          highlight.style.left = clippedRect.left + 'px';
          highlight.style.top = clippedRect.top + 'px';
          highlight.style.width = clippedRect.width + 'px';
          highlight.style.height = clippedRect.height + 'px';
          highlight.style.background = color;
          markdownSelectionOverlayRoot.appendChild(highlight);

          if (!labelAnchor) {
            labelAnchor = { left: clippedRect.left, top: clippedRect.top };
          }
        }
      }

      if (!labelAnchor) {
        continue;
      }

      const label = document.createElement('div');
      label.className = 'vf-markdown-editor__selection-label';
      label.setAttribute(DATA_VF_IGNORE, 'true');
      label.textContent = name;
      label.style.left = labelAnchor.left + 'px';
      label.style.top = labelAnchor.top + 'px';
      label.style.background = color;
      markdownSelectionOverlayRoot.appendChild(label);
    }

    if (markdownSelectionOverlayRoot.childNodes.length === 0) {
      clearMarkdownSelectionOverlay();
    }
  }

  function scheduleMarkdownSelectionOverlayRender() {
    if (markdownSelectionOverlayRenderFrame) {
      cancelAnimationFrame(markdownSelectionOverlayRenderFrame);
    }

    markdownSelectionOverlayRenderFrame = requestAnimationFrame(function() {
      markdownSelectionOverlayRenderFrame = null;
      renderMarkdownSelectionOverlay();
    });
  }

  function extractMarkdownParts(content) {
    if (typeof content !== 'string') {
      return {
        frontmatter: '',
        body: ''
      };
    }

    const frontmatterPattern = new RegExp(
      '^---[ \\\\t]*\\\\r?\\\\n[\\\\s\\\\S]*?\\\\r?\\\\n---[ \\\\t]*(?:\\\\r?\\\\n)?'
    );
    const match = content.match(frontmatterPattern);
    if (!match) {
      return {
        frontmatter: '',
        body: content
      };
    }

    return {
      frontmatter: match[0],
      body: content.slice(match[0].length)
    };
  }

  function composeMarkdownContent(body) {
    const safeBody = typeof body === 'string' ? body : '';
    if (!markdownFrontmatter) {
      return safeBody;
    }
    if (!safeBody) {
      return markdownFrontmatter;
    }
    if (markdownFrontmatter.endsWith('\\n')) {
      return markdownFrontmatter + safeBody;
    }
    return markdownFrontmatter + '\\n' + safeBody;
  }

  function extractRawBlocksForEditor(body, mdxImportMap) {
    const source = typeof body === 'string' ? body : '';
    const rawBlocks = [];
    const mdxBlocks = [];
    const tokenPrefix = 'VF_RAW_BLOCK_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const trackMdxBlocks = isMdxPage();
    const importMap = mdxImportMap && typeof mdxImportMap === 'object' ? mdxImportMap : {};
    const createToken = function(index) {
      return '[[' + tokenPrefix + '_' + index + ']]';
    };
    const registerMdxBlock = function(rawBlock, tokenIndex, offset, inputText) {
      if (!trackMdxBlocks) {
        return;
      }

      const trimmed = String(rawBlock || '').trimStart();
      const fence = String.fromCharCode(96, 96, 96);
      const startsWithTsxFence = trimmed.startsWith(fence + 'tsx') || trimmed.startsWith(fence + 'jsx');
      const startsWithUpperTag = /^<\\s*[A-Z]/.test(trimmed);
      const hasTsxProps = trimmed.indexOf('{') >= 0 && trimmed.indexOf('}') >= 0;

      if (!startsWithTsxFence && !startsWithUpperTag && !hasTsxProps) {
        return;
      }

      const label = startsWithTsxFence
        ? 'TSX block'
        : 'JSX ' + getMdxComponentName(trimmed);
      const componentName = getMdxComponentName(trimmed);
      const componentNamePattern = /^[A-Z][\\w$]*(?:\\.[A-Z][\\w$]*)*$/;
      const normalizedComponentName = componentNamePattern.test(componentName) ? componentName : '';
      const componentParts = normalizedComponentName ? normalizedComponentName.split('.') : [];
      const namespaceName = componentParts.length > 0 ? componentParts[0] : '';
      const fallbackSymbol = componentParts.length > 0 ? componentParts[componentParts.length - 1] : '';
      const directEntry = normalizedComponentName ? importMap[normalizedComponentName] : null;
      const namespaceEntry = !directEntry && namespaceName ? importMap[namespaceName] : null;
      const importEntry = directEntry || namespaceEntry || null;
      const entryPath = importEntry && typeof importEntry.filePath === 'string'
        ? importEntry.filePath
        : (
          typeof importEntry === 'string'
            ? importEntry
            : ''
        );
      const entrySymbol = importEntry && typeof importEntry.symbolName === 'string'
        ? importEntry.symbolName
        : '';
      const entryKind = importEntry && typeof importEntry.importKind === 'string'
        ? importEntry.importKind
        : '';
      const componentPath = entryPath || '';
      let componentSymbol = fallbackSymbol;
      if (entrySymbol) {
        componentSymbol = entrySymbol;
      } else if (entryKind === 'namespace' && componentParts.length > 1) {
        componentSymbol = componentParts[componentParts.length - 1];
      }
      mdxBlocks.push({
        tokenIndex: tokenIndex,
        label: label,
        lineNumber: getLineNumberForOffset(inputText, offset),
        filePath: componentPath,
        symbolName: componentSymbol
      });
    };
    const replaceWithToken = function(match, leadingNewline, offset, inputText) {
      const safeLeading = typeof leadingNewline === 'string' ? leadingNewline : '';
      const tokenIndex = rawBlocks.length;
      const rawBlock = typeof match === 'string' ? match.trimStart() : '';
      rawBlocks.push(rawBlock);
      registerMdxBlock(rawBlock, tokenIndex, Math.max(0, (offset || 0) + safeLeading.length), inputText || source);
      return safeLeading + createToken(tokenIndex);
    };

    const mermaidFencePattern = new RegExp(
      '(^|\\\\n)\\\\x60\\\\x60\\\\x60mermaid[^\\\\n]*\\\\n[\\\\s\\\\S]*?\\\\n\\\\x60\\\\x60\\\\x60(?=\\\\n|$)',
      'g'
    );
    const tsxFencePattern = new RegExp(
      '(^|\\\\n)\\\\x60\\\\x60\\\\x60(?:tsx|jsx)[^\\\\n]*\\\\n[\\\\s\\\\S]*?\\\\n\\\\x60\\\\x60\\\\x60(?=\\\\n|$)',
      'g'
    );
    const htmlBlockPattern = new RegExp(
      '(^|\\\\n)<[A-Za-z][\\\\w:-]*(?:\\\\s[^>\\\\n]*)?>[\\\\s\\\\S]*?<\\\\/[A-Za-z][\\\\w:-]*>(?=\\\\n|$)',
      'g'
    );
    const htmlSelfClosingPattern = new RegExp(
      '(^|\\\\n)<[A-Za-z][\\\\w:-]*(?:\\\\s[^>\\\\n]*)?\\\\/>(?=\\\\n|$)',
      'g'
    );

    let editorBody = source.replace(
      mermaidFencePattern,
      replaceWithToken
    );

    editorBody = editorBody.replace(
      tsxFencePattern,
      replaceWithToken
    );

    editorBody = editorBody.replace(
      htmlBlockPattern,
      replaceWithToken
    );

    editorBody = editorBody.replace(
      htmlSelfClosingPattern,
      replaceWithToken
    );

    return {
      editorBody: editorBody,
      rawBlocks: rawBlocks,
      mdxBlocks: mdxBlocks,
      tokenPrefix: tokenPrefix
    };
  }

  function restoreRawBlocksFromEditor(editorBody) {
    const source = typeof editorBody === 'string' ? editorBody : '';
    if (!source || markdownRawBlocks.length === 0) {
      return source;
    }
    const rawBlockTokenPattern = getMarkdownRawBlockTokenPattern();

    return source.replace(rawBlockTokenPattern, function(match, indexText) {
      const index = Number(indexText);
      if (!Number.isInteger(index) || index < 0 || index >= markdownRawBlocks.length) {
        return match;
      }
      const rawBlock = markdownRawBlocks[index];
      return typeof rawBlock === 'string' ? rawBlock : match;
    });
  }

  function handleMarkdownLocalChange(content) {
    if (typeof content !== 'string') {
      return;
    }

    markdownCurrentEditorContent = content;
    const restoredBody = restoreRawBlocksFromEditor(content);
    const fullContent = composeMarkdownContent(restoredBody);
    if (fullContent === markdownCurrentContent) {
      return;
    }
    markdownCurrentContent = fullContent;
    markdownHasUnsavedChanges = true;
    if (markdownYjsConnected) {
      syncLocalChangeToYText(fullContent);
    } else {
      scheduleMarkdownSync(fullContent);
    }
    scheduleMarkdownSelectionOverlayRender();
  }

  function saveMarkdownContent() {
    if (!markdownHasUnsavedChanges) {
      return;
    }
    markdownSaveInProgress = true;
    setMarkdownPersistStatus('saving');
    if (markdownSyncTimer) {
      clearTimeout(markdownSyncTimer);
      markdownSyncTimer = null;
    }
    postToStudio({
      action: 'markdownContentChange',
      fileId: markdownFileId,
      filePath: PAGE_PATH,
      content: markdownCurrentContent,
      save: true
    });
    markdownHasUnsavedChanges = false;
  }

  function setupMarkdownLexicalEditor() {
    if (!markdownEditorSurface || markdownLexicalApi || markdownLexicalSetupPromise) {
      return;
    }

    markdownLexicalSetupPromise = Promise.all([
      import('https://esm.sh/lexical@0.21.0?target=es2022'),
      import('https://esm.sh/@lexical/rich-text@0.21.0?target=es2022'),
      import('https://esm.sh/@lexical/list@0.21.0?target=es2022'),
      import('https://esm.sh/@lexical/markdown@0.21.0?target=es2022'),
      import('https://esm.sh/@lexical/history@0.21.0?target=es2022')
    ]).then(function(modules) {
      if (!markdownEditorSurface) {
        return;
      }

      const lexicalModule = modules[0];
      const richTextModule = modules[1];
      const listModule = modules[2];
      const markdownModule = modules[3];
      const historyModule = modules[4];

      const editor = lexicalModule.createEditor({
        namespace: 'veryfront-markdown-preview',
        nodes: [
          richTextModule.HeadingNode,
          richTextModule.QuoteNode,
          listModule.ListNode,
          listModule.ListItemNode
        ],
        onError: function(error) {
          console.error('[StudioBridge] Markdown Lexical error', error);
        }
      });

      const unregisterRichText = richTextModule.registerRichText(editor);
      const unregisterList = listModule.registerList(editor);
      const unregisterHistory = historyModule.registerHistory(
        editor,
        historyModule.createEmptyHistoryState(),
        1000
      );
      const unregisterUpdate = editor.registerUpdateListener(function(update) {
        if (markdownApplyingRemoteUpdate) {
          return;
        }

        let nextContent = '';
        update.editorState.read(function() {
          nextContent = markdownModule.$convertToMarkdownString(markdownModule.TRANSFORMERS, undefined, true);
        });
        const restoredBody = restoreRawBlocksFromEditor(nextContent);
        const fullContent = composeMarkdownContent(restoredBody);

        if (fullContent === markdownLexicalRenderedContent) {
          return;
        }
        markdownLexicalRenderedContent = fullContent;

        handleMarkdownLocalChange(nextContent);
        scheduleMarkdownSlashMenuUpdate();
        scheduleMarkdownInlineToolbarUpdate();
      });

      editor.setRootElement(markdownEditorSurface);
      editor.update(function() {
        const root = lexicalModule.$getRoot();
        if (root.getChildrenSize() === 0) {
          root.append(lexicalModule.$createParagraphNode());
        }
      });
      markdownLexicalApi = {
        editor: editor,
        lexicalModule: lexicalModule,
        markdownModule: markdownModule,
        unregisterRichText: unregisterRichText,
        unregisterList: unregisterList,
        unregisterHistory: unregisterHistory,
        unregisterUpdate: unregisterUpdate
      };

      markdownEditorSurface.style.display = 'block';
      if (markdownEditorTextarea) {
        markdownEditorTextarea.style.display = 'none';
      }

      applyMarkdownContent(markdownCurrentContent);
      hideMarkdownBlockDropIndicator();
    }).catch(function(error) {
      console.warn(
        '[StudioBridge] Failed to load Lexical markdown editor; falling back to textarea',
        error
      );
      if (markdownEditorSurface) {
        markdownEditorSurface.style.display = 'none';
      }
      if (markdownEditorTextarea) {
        markdownEditorTextarea.style.display = 'block';
      }
      hideMarkdownSlashMenu();
      hideMarkdownInlineToolbar();
      hideMarkdownBlockDragUi();
      clearMarkdownSelectionOverlay();
    });
  }

  function focusMarkdownEditor() {
    if (markdownLexicalApi && markdownEditorSurface) {
      markdownEditorSurface.focus();
      return;
    }
    if (markdownEditorTextarea) {
      markdownEditorTextarea.focus();
    }
  }

  function applyMarkdownHistoryCommand(command) {
    if (!markdownLexicalApi || !markdownLexicalApi.editor || !markdownLexicalApi.lexicalModule) {
      return;
    }
    if (!command) {
      return;
    }

    markdownLexicalApi.editor.focus();
    markdownLexicalApi.editor.dispatchCommand(command, undefined);
    scheduleMarkdownSelectionSync();
    scheduleMarkdownSelectionOverlayRender();
    scheduleMarkdownSlashMenuUpdate();
    scheduleMarkdownInlineToolbarUpdate();
  }

  function applyMarkdownContent(content) {
    if (typeof content !== 'string') {
      return;
    }

    if (markdownLexicalApi && markdownLexicalRenderedContent === content) {
      console.debug('[StudioBridge] applyMarkdownContent: skipped (content unchanged)');
      markdownCurrentContent = content;
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
      hideMarkdownBlockDropIndicator();
      return;
    }

    console.debug('[StudioBridge] applyMarkdownContent: rebuilding Lexical DOM, content length:', content.length, 'rendered match:', markdownLexicalRenderedContent === content, 'current match:', markdownCurrentContent === content);

    const mdxImportMap = parseMdxImportMap(content);
    const parts = extractMarkdownParts(content);
    const extracted = extractRawBlocksForEditor(parts.body, mdxImportMap);
    const editorContent = extracted.editorBody;
    const mdxBlocks = Array.isArray(extracted.mdxBlocks) ? extracted.mdxBlocks : [];
    markdownFrontmatter = parts.frontmatter;
    markdownRawBlocks = extracted.rawBlocks;
    markdownRawBlockTokenPrefix = extracted.tokenPrefix;
    markdownLatestMdxImportMap = mdxImportMap;
    setMarkdownMdxBlocks(mdxBlocks);

    markdownCurrentContent = content;
    markdownCurrentEditorContent = editorContent;

    if (markdownLexicalApi) {
      markdownApplyingRemoteUpdate = true;
      try {
        markdownLexicalRenderedContent = content;
        markdownLexicalApi.editor.update(function() {
          const lexicalModule = markdownLexicalApi.lexicalModule;
          const markdownModule = markdownLexicalApi.markdownModule;
          const root = lexicalModule.$getRoot();
          root.clear();
          markdownModule.$convertFromMarkdownString(editorContent, markdownModule.TRANSFORMERS, undefined, true);
          if (root.getChildrenSize() === 0) {
            root.append(lexicalModule.$createParagraphNode());
          }
        }, { discrete: true });
      } finally {
        markdownApplyingRemoteUpdate = false;
      }
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
      hideMarkdownBlockDropIndicator();
      return;
    }

    if (!markdownEditorTextarea || markdownEditorTextarea.value === editorContent) {
      clearMarkdownSelectionOverlay();
      hideMarkdownSlashMenu();
      hideMarkdownInlineToolbar();
      hideMarkdownBlockDragUi();
      return;
    }

    const selectionStart = markdownEditorTextarea.selectionStart;
    const selectionEnd = markdownEditorTextarea.selectionEnd;
    markdownEditorTextarea.value = editorContent;

    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      const max = markdownEditorTextarea.value.length;
      markdownEditorTextarea.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
    }
    clearMarkdownSelectionOverlay();
    hideMarkdownSlashMenu();
    hideMarkdownInlineToolbar();
    hideMarkdownBlockDragUi();
  }

  function setMarkdownPersistStatus(status) {
    if (!markdownPersistStatus) {
      return;
    }

    const nextStatus = status === 'saving' || status === 'saved' || status === 'error'
      ? status
      : 'saved';

    markdownPersistStatus.setAttribute('data-state', nextStatus);
    if (nextStatus === 'saving') {
      markdownPersistStatus.textContent = 'Saving...';
      return;
    }
    if (nextStatus === 'error') {
      markdownPersistStatus.textContent = 'Save failed';
      return;
    }
    markdownPersistStatus.textContent = 'Saved';
  }

  function setMarkdownPresence(users) {
    markdownLatestPresenceUsers = Array.isArray(users) ? users : [];
    if (!markdownPresenceRoot) {
      return;
    }

    markdownPresenceRoot.textContent = '';
    if (!Array.isArray(users) || users.length === 0) {
      markdownPresenceRoot.style.display = 'none';
      return;
    }

    const visibleUsers = users.filter(function(user) {
      return user && typeof user.name === 'string';
    }).slice(0, 4);

    if (visibleUsers.length === 0) {
      markdownPresenceRoot.style.display = 'none';
      return;
    }

    markdownPresenceRoot.style.display = 'inline-flex';

    for (const user of visibleUsers) {
      const pill = document.createElement('div');
      pill.className = 'vf-markdown-editor__presence-pill';
      pill.setAttribute(DATA_VF_IGNORE, 'true');
      pill.setAttribute('data-current', user.isCurrentUser ? 'true' : 'false');
      pill.setAttribute('data-agent', user.isAgent ? 'true' : 'false');
      pill.textContent = user.isCurrentUser ? 'You' : user.name;

      const color = typeof user.color === 'string' && user.color ? user.color : '#6b7280';
      pill.style.borderLeftColor = color;

      markdownPresenceRoot.appendChild(pill);
    }

    if (users.length > visibleUsers.length) {
      const extra = document.createElement('div');
      extra.className = 'vf-markdown-editor__presence-pill';
      extra.setAttribute(DATA_VF_IGNORE, 'true');
      extra.textContent = '+' + String(users.length - visibleUsers.length);
      markdownPresenceRoot.appendChild(extra);
    }
  }

  function setMarkdownSelections(selections) {
    markdownLatestSelections = Array.isArray(selections) ? selections : [];
    if (!markdownSelectionsRoot) {
      return;
    }

    markdownSelectionsRoot.textContent = '';
    markdownOverlaySelections = [];
    if (!Array.isArray(selections) || selections.length === 0) {
      markdownSelectionsRoot.style.display = 'none';
      clearMarkdownSelectionOverlay();
      return;
    }

    const visibleSelections = selections.filter(function(selection) {
      return (
        selection &&
        typeof selection.name === 'string' &&
        typeof selection.start === 'number' &&
        typeof selection.end === 'number'
      );
    }).slice(0, 4);

    if (visibleSelections.length === 0) {
      markdownSelectionsRoot.style.display = 'none';
      clearMarkdownSelectionOverlay();
      return;
    }

    markdownSelectionsRoot.style.display = 'inline-flex';

    for (const selection of visibleSelections) {
      const pill = document.createElement('div');
      pill.className = 'vf-markdown-editor__selection-pill';
      pill.setAttribute(DATA_VF_IGNORE, 'true');
      const color = typeof selection.color === 'string' && selection.color ? selection.color : '#6b7280';
      const displayName = selection.isCurrentUser ? 'You' : selection.name;
      pill.style.borderLeftColor = color;

      const start = Math.max(0, Math.trunc(selection.start));
      const end = Math.max(0, Math.trunc(selection.end));
      const rangeLabel = start === end ? '@' + String(start) : String(start) + '-' + String(end);
      pill.textContent = displayName + ' ' + rangeLabel;
      markdownSelectionsRoot.appendChild(pill);

      const editorRange = sourceSelectionToEditorRange(start, end);
      if (!editorRange) {
        continue;
      }

      markdownOverlaySelections.push({
        name: displayName,
        color: color,
        start: editorRange.start,
        end: editorRange.end
      });
    }

    if (selections.length > visibleSelections.length) {
      const extra = document.createElement('div');
      extra.className = 'vf-markdown-editor__selection-pill';
      extra.setAttribute(DATA_VF_IGNORE, 'true');
      extra.textContent = '+' + String(selections.length - visibleSelections.length);
      markdownSelectionsRoot.appendChild(extra);
    }

    scheduleMarkdownSelectionOverlayRender();
  }

  function ensureMarkdownEditor() {
    if (markdownEditorRoot) {
      return markdownEditorRoot;
    }

    const editorRoot = document.createElement('div');
    editorRoot.className = 'vf-markdown-editor';
    editorRoot.setAttribute(DATA_VF_IGNORE, 'true');

    const toolbar = document.createElement('div');
    toolbar.className = 'vf-markdown-editor__toolbar';
    toolbar.setAttribute(DATA_VF_IGNORE, 'true');

    const title = document.createElement('div');
    title.className = 'vf-markdown-editor__title';
    title.setAttribute(DATA_VF_IGNORE, 'true');

    const titleMain = document.createElement('div');
    titleMain.className = 'vf-markdown-editor__title-main';
    titleMain.setAttribute(DATA_VF_IGNORE, 'true');
    titleMain.textContent = 'Markdown editor';

    const titleHints = document.createElement('div');
    titleHints.className = 'vf-markdown-editor__title-hints';
    titleHints.setAttribute(DATA_VF_IGNORE, 'true');
    titleHints.textContent = '/ commands | Shift+Alt+Up/Down move block | Undo/Redo';

    title.appendChild(titleMain);
    title.appendChild(titleHints);

    const actions = document.createElement('div');
    actions.className = 'vf-markdown-editor__actions';
    actions.setAttribute(DATA_VF_IGNORE, 'true');

    const status = document.createElement('div');
    status.className = 'vf-markdown-editor__status';
    status.setAttribute(DATA_VF_IGNORE, 'true');
    status.textContent = '';
    status.setAttribute('data-state', '');

    const presence = document.createElement('div');
    presence.className = 'vf-markdown-editor__presence';
    presence.setAttribute(DATA_VF_IGNORE, 'true');

    const selections = document.createElement('div');
    selections.className = 'vf-markdown-editor__selections';
    selections.setAttribute(DATA_VF_IGNORE, 'true');

    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.className = 'vf-markdown-editor__history';
    undoButton.setAttribute(DATA_VF_IGNORE, 'true');
    undoButton.setAttribute('title', 'Undo');
    undoButton.textContent = 'Undo';
    undoButton.addEventListener('click', function() {
      if (!markdownLexicalApi || !markdownLexicalApi.lexicalModule) {
        return;
      }
      applyMarkdownHistoryCommand(markdownLexicalApi.lexicalModule.UNDO_COMMAND);
    });

    const redoButton = document.createElement('button');
    redoButton.type = 'button';
    redoButton.className = 'vf-markdown-editor__history';
    redoButton.setAttribute(DATA_VF_IGNORE, 'true');
    redoButton.setAttribute('title', 'Redo');
    redoButton.textContent = 'Redo';
    redoButton.addEventListener('click', function() {
      if (!markdownLexicalApi || !markdownLexicalApi.lexicalModule) {
        return;
      }
      applyMarkdownHistoryCommand(markdownLexicalApi.lexicalModule.REDO_COMMAND);
    });

    const openStudioButton = document.createElement('button');
    openStudioButton.type = 'button';
    openStudioButton.className = 'vf-markdown-editor__history';
    openStudioButton.setAttribute(DATA_VF_IGNORE, 'true');
    openStudioButton.setAttribute('title', 'Open file in Studio');
    openStudioButton.textContent = 'Open';
    openStudioButton.addEventListener('click', function() {
      openMarkdownSourceInStudio(1);
    });

    const exitButton = document.createElement('button');
    exitButton.type = 'button';
    exitButton.className = 'vf-markdown-editor__exit';
    exitButton.setAttribute(DATA_VF_IGNORE, 'true');
    exitButton.textContent = 'Done';
    exitButton.addEventListener('click', function() {
      setMarkdownEditMode(false);
    });

    actions.appendChild(status);
    actions.appendChild(presence);
    actions.appendChild(selections);
    actions.appendChild(undoButton);
    actions.appendChild(redoButton);
    actions.appendChild(openStudioButton);
    actions.appendChild(exitButton);

    toolbar.appendChild(title);
    toolbar.appendChild(actions);

    const mdxBlocks = document.createElement('div');
    mdxBlocks.className = 'vf-markdown-editor__mdx-blocks';
    mdxBlocks.setAttribute(DATA_VF_IGNORE, 'true');

    const surface = document.createElement('div');
    surface.className = 'vf-markdown-editor__surface markdown-body';
    surface.setAttribute(DATA_VF_IGNORE, 'true');
    surface.setAttribute('contenteditable', 'true');
    surface.setAttribute('aria-label', 'Markdown editor');
    surface.addEventListener('keyup', scheduleMarkdownSelectionSync);
    surface.addEventListener('mouseup', scheduleMarkdownSelectionSync);
    surface.addEventListener('input', function() {
      scheduleMarkdownSelectionSync();
      scheduleMarkdownSlashMenuUpdate();
    });
    surface.addEventListener('keyup', scheduleMarkdownSlashMenuUpdate);
    surface.addEventListener('mouseup', scheduleMarkdownSlashMenuUpdate);
    surface.addEventListener('keydown', handleMarkdownSlashMenuKeydown);
    surface.addEventListener('keydown', function(event) {
      if (!event.shiftKey || !event.altKey) {
        return;
      }
      if (event.key === 'ArrowUp') {
        const moved = moveMarkdownCurrentBlockByDelta(-1);
        if (moved) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        const moved = moveMarkdownCurrentBlockByDelta(1);
        if (moved) {
          event.preventDefault();
        }
      }
    });
    surface.addEventListener('keydown', function(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        saveMarkdownContent();
      }
    });
    surface.addEventListener('scroll', scheduleMarkdownSelectionOverlayRender);
    surface.addEventListener('scroll', scheduleMarkdownSlashMenuUpdate);
    surface.addEventListener('keyup', scheduleMarkdownInlineToolbarUpdate);
    surface.addEventListener('mouseup', scheduleMarkdownInlineToolbarUpdate);
    surface.addEventListener('input', scheduleMarkdownInlineToolbarUpdate);
    surface.addEventListener('scroll', scheduleMarkdownInlineToolbarUpdate);
    surface.addEventListener('scroll', refreshMarkdownBlockDragHandlePosition);

    const surfaceWrap = document.createElement('div');
    surfaceWrap.className = 'vf-markdown-editor__surface-wrap';
    surfaceWrap.setAttribute(DATA_VF_IGNORE, 'true');

    const selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'vf-markdown-editor__selection-overlay';
    selectionOverlay.setAttribute(DATA_VF_IGNORE, 'true');

    const slashMenu = document.createElement('div');
    slashMenu.className = 'vf-markdown-editor__slash-menu';
    slashMenu.setAttribute(DATA_VF_IGNORE, 'true');

    const inlineToolbar = document.createElement('div');
    inlineToolbar.className = 'vf-markdown-editor__inline-toolbar';
    inlineToolbar.setAttribute(DATA_VF_IGNORE, 'true');

    const boldButton = document.createElement('button');
    boldButton.type = 'button';
    boldButton.className = 'vf-markdown-editor__inline-button';
    boldButton.setAttribute(DATA_VF_IGNORE, 'true');
    boldButton.textContent = 'B';
    boldButton.addEventListener('mousedown', function(event) {
      event.preventDefault();
    });
    boldButton.addEventListener('click', function(event) {
      event.preventDefault();
      toggleMarkdownInlineFormat('bold');
    });

    const italicButton = document.createElement('button');
    italicButton.type = 'button';
    italicButton.className = 'vf-markdown-editor__inline-button';
    italicButton.setAttribute(DATA_VF_IGNORE, 'true');
    italicButton.textContent = 'I';
    italicButton.addEventListener('mousedown', function(event) {
      event.preventDefault();
    });
    italicButton.addEventListener('click', function(event) {
      event.preventDefault();
      toggleMarkdownInlineFormat('italic');
    });

    const codeButton = document.createElement('button');
    codeButton.type = 'button';
    codeButton.className = 'vf-markdown-editor__inline-button';
    codeButton.setAttribute(DATA_VF_IGNORE, 'true');
    codeButton.textContent = '</>';
    codeButton.addEventListener('mousedown', function(event) {
      event.preventDefault();
    });
    codeButton.addEventListener('click', function(event) {
      event.preventDefault();
      toggleMarkdownInlineFormat('code');
    });

    inlineToolbar.appendChild(boldButton);
    inlineToolbar.appendChild(italicButton);
    inlineToolbar.appendChild(codeButton);

    const blockDragHandle = document.createElement('button');
    blockDragHandle.type = 'button';
    blockDragHandle.className = 'vf-markdown-editor__block-handle';
    blockDragHandle.setAttribute(DATA_VF_IGNORE, 'true');
    blockDragHandle.textContent = '::';
    blockDragHandle.draggable = true;
    blockDragHandle.setAttribute('data-dragging', 'false');
    blockDragHandle.addEventListener('dragstart', function(event) {
      const indexText = blockDragHandle.getAttribute('data-block-index');
      const index = Number(indexText);
      if (!Number.isInteger(index)) {
        event.preventDefault();
        return;
      }
      markdownBlockDragSourceIndex = index;
      markdownBlockDragActive = true;
      blockDragHandle.setAttribute('data-dragging', 'true');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));

        const blocks = getMarkdownTopLevelBlocks();
        const block = blocks[index];
        removeMarkdownDragGhost();
        if (block) {
          const ghost = createMarkdownDragGhost(block);
          document.body.appendChild(ghost);
          markdownBlockDragGhost = ghost;
          event.dataTransfer.setDragImage(ghost, 14, 14);
        }
      }
      showMarkdownBlockDropIndicator(index);
    });
    blockDragHandle.addEventListener('mouseenter', function() {
      if (markdownBlockHandleHoverIndex >= 0) {
        blockDragHandle.style.display = 'block';
      }
    });
    blockDragHandle.addEventListener('mouseleave', function(event) {
      if (markdownBlockDragActive) {
        return;
      }
      const next = event.relatedTarget;
      if (next && markdownEditorSurface && markdownEditorSurface.contains(next)) {
        return;
      }
      hideMarkdownBlockDragHandle();
    });
    blockDragHandle.addEventListener('dragend', function() {
      hideMarkdownBlockDragUi();
    });

    const blockDropIndicator = document.createElement('div');
    blockDropIndicator.className = 'vf-markdown-editor__block-drop-indicator';
    blockDropIndicator.setAttribute(DATA_VF_IGNORE, 'true');

    const blockDropLabel = document.createElement('div');
    blockDropLabel.className = 'vf-markdown-editor__block-drop-label';
    blockDropLabel.setAttribute(DATA_VF_IGNORE, 'true');

    surfaceWrap.appendChild(surface);
    surfaceWrap.appendChild(selectionOverlay);

    const textarea = document.createElement('textarea');
    textarea.className = 'vf-markdown-editor__textarea';
    textarea.setAttribute(DATA_VF_IGNORE, 'true');
    textarea.setAttribute('aria-label', 'Markdown editor');
    textarea.spellcheck = false;
    textarea.addEventListener('input', function() {
      handleMarkdownLocalChange(textarea.value);
      scheduleMarkdownSelectionSync();
      hideMarkdownSlashMenu();
    });
    textarea.addEventListener('select', scheduleMarkdownSelectionSync);
    textarea.addEventListener('keyup', scheduleMarkdownSelectionSync);
    textarea.addEventListener('click', scheduleMarkdownSelectionSync);
    textarea.addEventListener('input', clearMarkdownSelectionOverlay);
    textarea.addEventListener('keydown', function() {
      hideMarkdownSlashMenu();
      hideMarkdownInlineToolbar();
      hideMarkdownBlockDragUi();
    });

    surface.addEventListener('mousemove', function(event) {
      if (markdownBlockDragActive) {
        return;
      }

      const index = getMarkdownBlockHoverIndexFromPointer(event.target, event.clientX, event.clientY);
      if (index < 0) {
        hideMarkdownBlockDragHandle();
        return;
      }
      const blocks = getMarkdownTopLevelBlocks();
      const block = blocks[index];
      if (!block) {
        hideMarkdownBlockDragHandle();
        return;
      }
      positionMarkdownBlockDragHandle(block, index);
    });

    surface.addEventListener('mouseleave', function(event) {
      if (!markdownBlockDragActive) {
        const next = event.relatedTarget;
        if (next && markdownBlockDragHandle && (next === markdownBlockDragHandle || markdownBlockDragHandle.contains(next))) {
          return;
        }
        hideMarkdownBlockDragHandle();
      }
    });

    surface.addEventListener('dragover', function(event) {
      if (!markdownBlockDragActive) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      autoScrollMarkdownSurfaceDuringDrag(event.clientY);
      const slotIndex = getMarkdownDropSlotIndexFromPointer(event.clientY);
      if (slotIndex >= 0) {
        showMarkdownBlockDropIndicator(slotIndex);
      }
    });

    surface.addEventListener('drop', function(event) {
      if (!markdownBlockDragActive) {
        return;
      }
      event.preventDefault();

      const fallbackSlot = getMarkdownDropSlotIndexFromPointer(event.clientY);
      const slotIndex = markdownBlockDropSlotIndex >= 0 ? markdownBlockDropSlotIndex : fallbackSlot;
      const sourceIndex = markdownBlockDragSourceIndex;
      hideMarkdownBlockDragUi();
      if (sourceIndex < 0 || slotIndex < 0) {
        return;
      }
      moveMarkdownLexicalBlock(sourceIndex, slotIndex);
    });

    document.addEventListener('selectionchange', function() {
      if (!markdownEditorRoot || markdownEditorRoot.style.display !== 'block') {
        return;
      }
      scheduleMarkdownSelectionSync();
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
    });

    window.addEventListener('resize', scheduleMarkdownSelectionOverlayRender);
    window.addEventListener('resize', scheduleMarkdownSlashMenuUpdate);
    window.addEventListener('resize', scheduleMarkdownInlineToolbarUpdate);
    window.addEventListener('resize', hideMarkdownBlockDragUi);

    editorRoot.appendChild(toolbar);
    editorRoot.appendChild(mdxBlocks);
    editorRoot.appendChild(surfaceWrap);
    editorRoot.appendChild(textarea);
    editorRoot.appendChild(slashMenu);
    editorRoot.appendChild(inlineToolbar);
    editorRoot.appendChild(blockDragHandle);
    editorRoot.appendChild(blockDropIndicator);
    editorRoot.appendChild(blockDropLabel);
    document.body.appendChild(editorRoot);

    markdownEditorRoot = editorRoot;
    markdownEditorSurface = surface;
    markdownEditorTextarea = textarea;
    markdownPersistStatus = status;
    markdownPresenceRoot = presence;
    markdownSelectionsRoot = selections;
    markdownMdxBlocksRoot = mdxBlocks;
    markdownSelectionOverlayRoot = selectionOverlay;
    markdownSlashMenuRoot = slashMenu;
    markdownInlineToolbarRoot = inlineToolbar;
    markdownBlockDragHandle = blockDragHandle;
    markdownBlockDropIndicator = blockDropIndicator;
    markdownBlockDropLabel = blockDropLabel;
    setMarkdownMdxBlocks(markdownLatestMdxBlocks);
    setMarkdownPresence(markdownLatestPresenceUsers);
    setMarkdownSelections(markdownLatestSelections);
    setupMarkdownLexicalEditor();
    applyMarkdownContent(markdownCurrentContent);

    return editorRoot;
  }

  function setMarkdownEditMode(enabled) {
    const markdownBody = document.getElementById('markdown-body');
    if (!markdownBody || !isMarkdownPage()) {
      return;
    }

    if (enabled) {
      ensureMarkdownEditor();
      setupMarkdownLexicalEditor();
      markdownBody.style.display = 'none';
      markdownEditorRoot.style.display = 'block';
      markdownHasUnsavedChanges = false;
      focusMarkdownEditor();
      scheduleMarkdownSelectionSync();
      scheduleMarkdownSelectionOverlayRender();
      scheduleMarkdownSlashMenuUpdate();
      scheduleMarkdownInlineToolbarUpdate();
      postMarkdownEditorReady();
    } else {
      markdownBody.style.display = '';
      if (markdownEditorRoot) {
        markdownEditorRoot.style.display = 'none';
      }
      hideMarkdownSlashMenu();
      hideMarkdownInlineToolbar();
      hideMarkdownBlockDragUi();
      markdownOverlaySelections = [];
      clearMarkdownSelectionOverlay();
      clearMarkdownSelectionSync();
      disposeMarkdownYjs();
    }

    const nextUrl = new URL(window.location.href);
    if (enabled) {
      nextUrl.searchParams.set('edit', 'true');
    } else {
      nextUrl.searchParams.delete('edit');
    }
    window.history.replaceState(window.history.state, '', nextUrl.toString());
  }

  function ensureMarkdownEditButton() {
    if (markdownEditButton || !isMarkdownPage()) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vf-markdown-edit-button';
    button.textContent = 'Edit';
    button.setAttribute(DATA_VF_IGNORE, 'true');
    button.addEventListener('click', function() {
      setMarkdownEditMode(true);
    });

    document.body.appendChild(button);
    markdownEditButton = button;
  }

  function setupMarkdownEditor(params) {
    if (!isMarkdownPage()) {
      return;
    }

    markdownFileId = params.get('vf_file_id') || PAGE_ID || null;
    ensureMarkdownEditButton();

    if (params.get('edit') === 'true') {
      setMarkdownEditMode(true);
    }
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
      script.onerror = (event) => {
        console.warn(
          '[StudioBridge] Failed to load html2canvas script. This may be caused by CSP script-src restrictions.',
          event
        );
        reject(new Error('Failed to load html2canvas script'));
      };
      try {
        document.head.appendChild(script);
      } catch (error) {
        console.warn(
          '[StudioBridge] Failed to append html2canvas script element. This may be caused by CSP script-src restrictions.',
          error
        );
        reject(error instanceof Error ? error : new Error('Failed to append html2canvas script element'));
      }
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

      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        console.error('[bridge] html2canvas produced empty canvas:', canvas?.width, 'x', canvas?.height);
        window.scrollTo(0, originalScrollY);
        return {
          success: false,
          error: 'html2canvas produced empty canvas (0x0 dimensions)'
        };
      }

      const dataUrl = canvas.toDataURL('image/png', quality);

      if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length < 100) {
        console.error('[bridge] html2canvas produced invalid data URL:', dataUrl?.substring(0, 50));
        window.scrollTo(0, originalScrollY);
        return {
          success: false,
          error: 'html2canvas produced invalid image data'
        };
      }

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
      console.error('[bridge] html2canvas error:', error);
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

      case 'setMarkdownContent':
        if (!isMarkdownPage()) {
          return;
        }
        if (message.fileId && markdownFileId && message.fileId !== markdownFileId) {
          return;
        }
        if (markdownYjsConnected) {
          return;
        }
        applyMarkdownContent(message.content || '');
        return;

      case 'initYjsConnection':
        if (!isMarkdownPage()) {
          return;
        }
        if (message.fileId && markdownFileId && message.fileId !== markdownFileId) {
          return;
        }
        if (message.initialContent) {
          applyMarkdownContent(message.initialContent);
        }
        setupMarkdownYjsConnection({
          wsUrl: message.wsUrl,
          guid: message.guid,
          fileId: message.fileId || markdownFileId,
          authToken: message.authToken
        });
        return;

      case 'setMarkdownPersistState':
        if (!isMarkdownPage()) {
          return;
        }
        if (message.fileId && markdownFileId && message.fileId !== markdownFileId) {
          return;
        }
        if (markdownSaveInProgress) {
          setMarkdownPersistStatus(message.status || 'saved');
          if (message.status === 'saved' || message.status === 'error') {
            markdownSaveInProgress = false;
            markdownHasUnsavedChanges = false;
          }
        }
        return;

      case 'setMarkdownPresence':
        if (!isMarkdownPage()) {
          return;
        }
        if (message.fileId && markdownFileId && message.fileId !== markdownFileId) {
          return;
        }
        setMarkdownPresence(message.users);
        return;

      case 'setMarkdownSelections':
        if (!isMarkdownPage()) {
          return;
        }
        if (message.fileId && markdownFileId && message.fileId !== markdownFileId) {
          return;
        }
        setMarkdownSelections(message.selections);
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
    setupMarkdownEditor(params);

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

  if (DEBUG_EXPOSE_INTERNALS && typeof window !== 'undefined') {
    window.__VF_STUDIO_BRIDGE_DEBUG = {
      parseMdxImportMap: parseMdxImportMap,
      extractRawBlocksForEditor: extractRawBlocksForEditor,
      getMdxBlockOpenUiState: getMdxBlockOpenUiState
    };
  }

  if (!DEBUG_SKIP_INIT) {
    init();
  }
})();`;
}
