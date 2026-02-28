/**
 * Bridge Styles
 * CSS injection for overlay, editor, and inspector styles.
 */

const OVERLAY_CSS = `
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
        padding: 8px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        background: rgba(255, 255, 255, 0.94);
        position: sticky;
        top: 0;
      }

      .vf-markdown-editor__title {
        font-size: 12px;
        color: #6b7280;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 4px;
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
        min-width: 240px;
        max-width: 300px;
        border: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0, 0, 0, 0.1);
        padding: 4px;
        display: none;
      }

      .vf-markdown-editor__slash-section {
        padding: 8px 10px 4px;
        font-size: 11px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: none;
        letter-spacing: 0;
      }

      .vf-markdown-editor__slash-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        border: 0;
        border-radius: 6px;
        background: transparent;
        text-align: left;
        padding: 6px 10px;
        cursor: pointer;
      }

      .vf-markdown-editor__slash-item:hover,
      .vf-markdown-editor__slash-item[data-active='true'] {
        background: rgba(0, 0, 0, 0.04);
      }

      .vf-markdown-editor__slash-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 4px;
        background: #ffffff;
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        flex-shrink: 0;
      }

      .vf-markdown-editor__slash-item-title {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: #111827;
        line-height: 1.35;
        flex: 1;
      }

      .vf-markdown-editor__slash-item-desc {
        display: none;
      }

      .vf-markdown-editor__slash-shortcut {
        font-size: 11px;
        color: #9ca3af;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        flex-shrink: 0;
      }

      .vf-markdown-editor__slash-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        margin-top: 2px;
        border-top: 1px solid rgba(0, 0, 0, 0.06);
        font-size: 11px;
        color: #9ca3af;
      }

      .vf-markdown-editor__slash-footer-key {
        font-size: 10px;
        color: #9ca3af;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 3px;
        padding: 1px 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .vf-markdown-editor__inline-toolbar {
        position: fixed;
        z-index: 100006;
        display: none;
        flex-direction: column;
        min-width: 200px;
        border: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 0 1px rgba(0, 0, 0, 0.1);
        padding: 4px;
      }

      .vf-markdown-editor__inline-row {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 2px 0;
      }

      .vf-markdown-editor__inline-separator {
        width: 1px;
        height: 20px;
        background: rgba(0, 0, 0, 0.1);
        margin: 0 2px;
        flex-shrink: 0;
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
        height: 26px;
        padding: 0 7px;
        cursor: pointer;
      }

      .vf-markdown-editor__inline-button:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .vf-markdown-editor__inline-button.active {
        background: rgba(0, 129, 248, 0.14);
        color: #0081f8;
      }

      .vf-markdown-editor__inline-button[data-format='bold'] {
        font-weight: 700;
      }

      .vf-markdown-editor__inline-button[data-format='italic'] {
        font-style: italic;
      }

      .vf-markdown-editor__inline-button[data-format='strikethrough'] {
        text-decoration: line-through;
      }

      .vf-markdown-editor__inline-button[data-format='underline'] {
        text-decoration: underline;
      }

      .vf-markdown-editor__block-trigger {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #111827;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        height: 26px;
        padding: 0 7px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 2px;
        white-space: nowrap;
      }

      .vf-markdown-editor__block-trigger:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .vf-markdown-editor__block-trigger::after {
        content: '\\25BE';
        font-size: 10px;
        color: #9ca3af;
      }

      .vf-markdown-editor__block-dropdown {
        position: absolute;
        top: 100%;
        left: 4px;
        z-index: 100007;
        min-width: 160px;
        border: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
        padding: 4px;
        margin-top: 4px;
        display: none;
      }

      .vf-markdown-editor__block-option {
        display: block;
        width: 100%;
        border: 0;
        border-radius: 6px;
        background: transparent;
        text-align: left;
        padding: 6px 10px;
        font-size: 13px;
        font-weight: 500;
        color: #111827;
        cursor: pointer;
      }

      .vf-markdown-editor__block-option:hover {
        background: rgba(0, 0, 0, 0.04);
      }

      .vf-markdown-editor__block-option.active {
        background: rgba(0, 129, 248, 0.1);
        color: #0081f8;
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
        content: "Type '/' for commands";
        color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        font-style: normal;
      }

      .vf-markdown-editor__surface h1:empty::before {
        content: 'Heading 1';
        color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }

      .vf-markdown-editor__surface h2:empty::before {
        content: 'Heading 2';
        color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }

      .vf-markdown-editor__surface h3:empty::before {
        content: 'Heading 3';
        color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }

      .vf-markdown-editor__surface blockquote:empty::before {
        content: 'Quote';
        color: rgba(0, 0, 0, 0.3);
        pointer-events: none;
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
        border-bottom-color: rgba(255, 255, 255, 0.08);
        background: rgba(17, 24, 39, 0.92);
      }

      [data-theme='dark'] .vf-markdown-editor__title {
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
        border-color: rgba(255, 255, 255, 0.15);
        background: #1e293b;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-section {
        color: #6b7280;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item:hover,
      [data-theme='dark'] .vf-markdown-editor__slash-item[data-active='true'] {
        background: rgba(255, 255, 255, 0.08);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-icon {
        border-color: rgba(255, 255, 255, 0.15);
        background: #1e293b;
        color: #d1d5db;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item-title {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-shortcut {
        color: #6b7280;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-footer {
        border-top-color: rgba(255, 255, 255, 0.08);
        color: #6b7280;
      }

      [data-theme='dark'] .vf-markdown-editor__slash-footer-key {
        border-color: rgba(255, 255, 255, 0.15);
        color: #6b7280;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-toolbar {
        border-color: rgba(255, 255, 255, 0.15);
        background: #1e293b;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-separator {
        background: rgba(255, 255, 255, 0.12);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button.active {
        background: rgba(59, 130, 246, 0.24);
        color: #60a5fa;
      }

      [data-theme='dark'] .vf-markdown-editor__block-trigger {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__block-trigger:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      [data-theme='dark'] .vf-markdown-editor__block-trigger::after {
        color: #6b7280;
      }

      [data-theme='dark'] .vf-markdown-editor__block-dropdown {
        border-color: rgba(255, 255, 255, 0.15);
        background: #1e293b;
      }

      [data-theme='dark'] .vf-markdown-editor__block-option {
        color: #f9fafb;
      }

      [data-theme='dark'] .vf-markdown-editor__block-option:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      [data-theme='dark'] .vf-markdown-editor__block-option.active {
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
      }

      [data-theme='dark'] .vf-markdown-editor__surface p:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h1:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h2:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h3:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface blockquote:empty::before {
        color: rgba(255, 255, 255, 0.2);
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
`;

export function injectOverlayStyles(): void {
  if (document.getElementById('vf-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'vf-overlay-styles';
  style.textContent = OVERLAY_CSS;
  try {
    document.head.appendChild(style);
    if (!style.sheet) {
      console.warn('[StudioBridge] Inline style injection may be blocked by CSP (style-src).');
    }
  } catch (error) {
    console.warn('[StudioBridge] Failed to inject bridge styles. This may be caused by CSP style-src restrictions.', error);
  }
}
