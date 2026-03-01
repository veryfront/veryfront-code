/**
 * Bridge Styles
 * CSS injection for overlay, editor, and inspector styles.
 *
 * Design tokens are hardcoded to match Studio's visual language (oklch color
 * space, radii, shadows, spacing). Uses system font stack since Studio's
 * Gellix font is proprietary and unavailable in the preview iframe.
 */

const OVERLAY_CSS = `
      /* ------------------------------------------------------------------ */
      /* Overlays (hover / selection inspector)                              */
      /* ------------------------------------------------------------------ */

      .vf-overlay {
        position: fixed;
        pointer-events: none;
        z-index: 99999;
        box-sizing: border-box;
        transition: all 0.05s ease-out;
      }
      .vf-overlay-hover {
        border: 2px solid oklch(0.6852 0.162 241.8);
        background: oklch(0.6852 0.162 241.8 / 0.06);
      }
      .vf-overlay-selection {
        border: 2px solid oklch(0.6852 0.162 241.8);
        background: oklch(0.6852 0.162 241.8 / 0.1);
      }
      .vf-overlay-label {
        position: absolute;
        top: -22px;
        left: -2px;
        background: oklch(0.6852 0.162 241.8);
        color: white;
        font-size: 11px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
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

      /* ------------------------------------------------------------------ */
      /* Edit button (floating CTA)                                          */
      /* ------------------------------------------------------------------ */

      .vf-markdown-edit-button {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 100001;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 9999px;
        background: oklch(0.2768 0 0);
        color: oklch(0.9512 0.008 98.88);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        font-weight: 500;
        line-height: 1;
        padding: 10px 16px;
        cursor: pointer;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
        transition: transform 100ms ease, box-shadow 100ms ease;
      }
      .vf-markdown-edit-button:hover {
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
      }
      .vf-markdown-edit-button:active {
        transform: scale(0.98);
      }

      /* ------------------------------------------------------------------ */
      /* Editor root                                                         */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: oklch(1 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        display: none;
      }

      .vf-markdown-editor__history {
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 6px;
        background: oklch(1 0 0);
        color: oklch(0.2768 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        line-height: 1;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        cursor: pointer;
        transition: background 75ms ease;
      }
      .vf-markdown-editor__history:hover {
        background: oklch(0.93 0 0);
      }

      /* ------------------------------------------------------------------ */
      /* Surface (editor area)                                               */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__surface-wrap {
        position: relative;
        height: 100vh;
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

      /* ------------------------------------------------------------------ */
      /* Selection overlay                                                   */
      /* ------------------------------------------------------------------ */

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
        border-radius: 9999px;
        padding: 1px 7px;
        font-size: 10px;
        line-height: 1.4;
        white-space: nowrap;
        color: oklch(1 0 0);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      }

      /* ------------------------------------------------------------------ */
      /* Slash menu                                                          */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__slash-menu {
        position: fixed;
        z-index: 100005;
        min-width: 240px;
        max-width: 300px;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 8px;
        background: oklch(1 0 0);
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
        padding: 4px;
        display: none;
      }

      .vf-markdown-editor__slash-section {
        padding: 8px 10px 4px;
        font-size: 11px;
        font-weight: 600;
        color: oklch(0.55 0.005 95.11);
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
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        text-align: left;
        padding: 6px 10px;
        cursor: pointer;
        transition: background 75ms ease;
      }

      .vf-markdown-editor__slash-item:hover,
      .vf-markdown-editor__slash-item[data-active='true'] {
        background: oklch(0.93 0 0);
      }

      .vf-markdown-editor__slash-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 4px;
        background: oklch(1 0 0);
        font-size: 13px;
        font-weight: 600;
        color: oklch(0.2768 0 0);
        flex-shrink: 0;
      }

      .vf-markdown-editor__slash-item-title {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: oklch(0.2768 0 0);
        line-height: 1.35;
        flex: 1;
      }

      .vf-markdown-editor__slash-item-desc {
        display: none;
      }

      .vf-markdown-editor__slash-shortcut {
        font-size: 11px;
        color: oklch(0.55 0.005 95.11);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        flex-shrink: 0;
      }

      .vf-markdown-editor__slash-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        margin-top: 2px;
        border-top: 1px solid oklch(0.9 0 0);
        font-size: 11px;
        color: oklch(0.55 0.005 95.11);
      }

      .vf-markdown-editor__slash-footer-key {
        font-size: 10px;
        color: oklch(0.55 0.005 95.11);
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 3px;
        padding: 1px 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      /* ------------------------------------------------------------------ */
      /* Inline toolbar                                                      */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__inline-toolbar {
        position: fixed;
        z-index: 100006;
        display: none;
        flex-direction: column;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 8px;
        background: oklch(1 0 0);
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
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
        background: oklch(0.9 0 0);
        margin: 0 2px;
        flex-shrink: 0;
      }

      .vf-markdown-editor__inline-button {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: oklch(0.2768 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        min-width: 26px;
        height: 26px;
        padding: 0 7px;
        cursor: pointer;
        transition: background 75ms ease;
      }

      .vf-markdown-editor__inline-button:hover {
        background: oklch(0.93 0 0);
      }

      .vf-markdown-editor__inline-button.active {
        background: oklch(0.6852 0.162 241.8 / 0.14);
        color: oklch(0.6852 0.162 241.8);
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

      /* ------------------------------------------------------------------ */
      /* Block type trigger                                                  */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__block-trigger {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: oklch(0.2768 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
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
        transition: background 75ms ease;
      }

      .vf-markdown-editor__block-trigger:hover {
        background: oklch(0.93 0 0);
      }

      .vf-markdown-editor__block-trigger::after {
        content: '\\25BE';
        font-size: 10px;
        color: oklch(0.55 0.005 95.11);
      }

      /* ------------------------------------------------------------------ */
      /* Block dropdown                                                      */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__block-dropdown {
        position: absolute;
        top: 100%;
        left: 4px;
        z-index: 100007;
        min-width: 160px;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 6px;
        background: oklch(1 0 0);
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
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
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        text-align: left;
        padding: 6px 10px;
        font-size: 13px;
        font-weight: 500;
        color: oklch(0.2768 0 0);
        cursor: pointer;
        transition: background 75ms ease;
      }

      .vf-markdown-editor__block-option:hover {
        background: oklch(0.93 0 0);
      }

      .vf-markdown-editor__block-option.active {
        background: oklch(0.6852 0.162 241.8 / 0.1);
        color: oklch(0.6852 0.162 241.8);
      }

      /* ------------------------------------------------------------------ */
      /* Block drag handle                                                   */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__block-handle {
        position: fixed;
        z-index: 100007;
        display: none;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 6px;
        background: oklch(1 0 0);
        color: oklch(0.2768 0 0);
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        width: 28px;
        height: 28px;
        padding: 0;
        cursor: grab;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1);
        transition: background 75ms ease, box-shadow 75ms ease;
      }

      .vf-markdown-editor__block-handle:hover {
        background: oklch(0.6852 0.162 241.8 / 0.1);
      }

      .vf-markdown-editor__block-handle[data-dragging='true'] {
        cursor: grabbing;
      }

      /* ------------------------------------------------------------------ */
      /* Block drop indicator                                                */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__block-drop-indicator {
        position: fixed;
        z-index: 100006;
        display: none;
        height: 2px;
        border-radius: 9999px;
        background: oklch(0.6852 0.162 241.8);
        box-shadow: 0 1px 6px oklch(0.6852 0.162 241.8 / 0.5);
      }

      .vf-markdown-editor__block-drop-label {
        position: fixed;
        z-index: 100007;
        display: none;
        border-radius: 9999px;
        border: 1px solid oklch(0.6852 0.162 241.8 / 0.24);
        background: oklch(1 0 0 / 0.96);
        color: oklch(0.2768 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.2;
        padding: 3px 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1);
      }

      /* ------------------------------------------------------------------ */
      /* Block drag ghost                                                    */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__block-drag-ghost {
        position: fixed;
        top: -9999px;
        left: -9999px;
        width: 260px;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 8px;
        background: oklch(1 0 0);
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
        padding: 8px 10px;
      }

      .vf-markdown-editor__block-drag-ghost-title {
        display: block;
        font-size: 11px;
        font-weight: 700;
        color: oklch(0.2768 0 0);
      }

      .vf-markdown-editor__block-drag-ghost-text {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: oklch(0.55 0.005 95.11);
        line-height: 1.35;
      }

      /* ------------------------------------------------------------------ */
      /* MDX blocks bar                                                      */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__mdx-blocks {
        display: none;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid oklch(0.9 0 0);
        background: oklch(0.97 0 0 / 0.95);
        overflow-x: auto;
      }

      .vf-markdown-editor__mdx-block {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 6px;
        background: oklch(1 0 0);
        padding: 6px 8px;
      }

      .vf-markdown-editor__mdx-block-label {
        font-size: 11px;
        color: oklch(0.2768 0 0);
        white-space: nowrap;
      }

      .vf-markdown-editor__mdx-note {
        font-size: 10px;
        color: oklch(0.55 0.005 95.11);
        white-space: nowrap;
      }

      .vf-markdown-editor__mdx-open {
        border: 1px solid oklch(0.84 0.0055 95.11);
        border-radius: 6px;
        background: oklch(1 0 0);
        color: oklch(0.2768 0 0);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        line-height: 1;
        padding: 5px 7px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 75ms ease;
      }
      .vf-markdown-editor__mdx-open:hover {
        background: oklch(0.93 0 0);
      }

      /* ------------------------------------------------------------------ */
      /* Lexical surface overrides                                           */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__surface [data-lexical-editor] {
        outline: none;
      }

      .vf-markdown-editor__surface s,
      .vf-markdown-editor__surface del,
      .vf-markdown-editor__surface [style*='line-through'] {
        text-decoration: line-through;
      }

      .vf-markdown-editor__surface p:empty::before {
        content: "Type '/' for commands";
        color: oklch(0.55 0.005 95.11 / 0.6);
        pointer-events: none;
        font-style: normal;
      }

      .vf-markdown-editor__surface h1:empty::before {
        content: 'Heading 1';
        color: oklch(0.55 0.005 95.11 / 0.6);
        pointer-events: none;
      }

      .vf-markdown-editor__surface h2:empty::before {
        content: 'Heading 2';
        color: oklch(0.55 0.005 95.11 / 0.6);
        pointer-events: none;
      }

      .vf-markdown-editor__surface h3:empty::before {
        content: 'Heading 3';
        color: oklch(0.55 0.005 95.11 / 0.6);
        pointer-events: none;
      }

      .vf-markdown-editor__surface blockquote:empty::before {
        content: 'Quote';
        color: oklch(0.55 0.005 95.11 / 0.6);
        pointer-events: none;
      }

      .vf-markdown-editor__surface p {
        min-height: 1.5em;
      }

      /* ------------------------------------------------------------------ */
      /* Textarea fallback                                                   */
      /* ------------------------------------------------------------------ */

      .vf-markdown-editor__textarea {
        width: 100%;
        height: 100vh;
        border: 0;
        outline: none;
        resize: none;
        display: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.6;
        color: oklch(0.2768 0 0);
        background: transparent;
        padding: 16px;
        box-sizing: border-box;
      }

      /* ================================================================== */
      /* DARK MODE                                                           */
      /* ================================================================== */

      [data-theme='dark'] .vf-markdown-editor {
        background: oklch(0.2768 0 0);
      }

      [data-theme='dark'] .vf-markdown-editor__history {
        background: oklch(0.3211 0 0);
        border-color: oklch(0.42 0.0017 106.48);
        color: oklch(0.9512 0.008 98.88);
      }
      [data-theme='dark'] .vf-markdown-editor__history:hover {
        background: oklch(0.25 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__textarea {
        color: oklch(0.9512 0.008 98.88);
      }

      /* Slash menu – dark */

      [data-theme='dark'] .vf-markdown-editor__slash-menu {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.21 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-section {
        color: oklch(0.5338 0.0046 106.55);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item:hover,
      [data-theme='dark'] .vf-markdown-editor__slash-item[data-active='true'] {
        background: oklch(0.25 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-icon {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.3211 0 0);
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-item-title {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-shortcut {
        color: oklch(0.5338 0.0046 106.55);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-footer {
        border-top-color: oklch(0.3 0.01 220);
        color: oklch(0.5338 0.0046 106.55);
      }

      [data-theme='dark'] .vf-markdown-editor__slash-footer-key {
        border-color: oklch(0.42 0.0017 106.48);
        color: oklch(0.5338 0.0046 106.55);
      }

      /* Inline toolbar – dark */

      [data-theme='dark'] .vf-markdown-editor__inline-toolbar {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.21 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-separator {
        background: oklch(0.3 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button:hover {
        background: oklch(0.25 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__inline-button.active {
        background: oklch(0.6852 0.162 241.8 / 0.2);
        color: oklch(0.75 0.14 241.8);
      }

      /* Block trigger – dark */

      [data-theme='dark'] .vf-markdown-editor__block-trigger {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__block-trigger:hover {
        background: oklch(0.25 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__block-trigger::after {
        color: oklch(0.5338 0.0046 106.55);
      }

      /* Block dropdown – dark */

      [data-theme='dark'] .vf-markdown-editor__block-dropdown {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.21 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__block-option {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__block-option:hover {
        background: oklch(0.25 0.01 220);
      }

      [data-theme='dark'] .vf-markdown-editor__block-option.active {
        background: oklch(0.6852 0.162 241.8 / 0.2);
        color: oklch(0.75 0.14 241.8);
      }

      /* Placeholder text – dark */

      [data-theme='dark'] .vf-markdown-editor__surface p:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h1:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h2:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface h3:empty::before,
      [data-theme='dark'] .vf-markdown-editor__surface blockquote:empty::before {
        color: oklch(0.5338 0.0046 106.55 / 0.5);
      }

      /* Block drag – dark */

      [data-theme='dark'] .vf-markdown-editor__block-handle {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.3211 0 0);
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__block-handle:hover {
        background: oklch(0.6852 0.162 241.8 / 0.2);
      }

      [data-theme='dark'] .vf-markdown-editor__block-drop-label {
        border-color: oklch(0.6852 0.162 241.8 / 0.35);
        background: oklch(0.18 0.01 220 / 0.96);
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.3211 0 0);
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost-title {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__block-drag-ghost-text {
        color: oklch(0.5338 0.0046 106.55);
      }

      /* MDX blocks – dark */

      [data-theme='dark'] .vf-markdown-editor__mdx-blocks {
        border-bottom-color: oklch(0.3 0.01 220);
        background: oklch(0.18 0.01 220 / 0.8);
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-block {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.3211 0 0);
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-block-label {
        color: oklch(0.9512 0.008 98.88);
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-note {
        color: oklch(0.5338 0.0046 106.55);
      }

      [data-theme='dark'] .vf-markdown-editor__mdx-open {
        border-color: oklch(0.42 0.0017 106.48);
        background: oklch(0.2768 0 0);
        color: oklch(0.9512 0.008 98.88);
      }
      [data-theme='dark'] .vf-markdown-editor__mdx-open:hover {
        background: oklch(0.25 0.01 220);
      }

      /* Edit button – dark */

      [data-theme='dark'] .vf-markdown-edit-button {
        background: oklch(0.9512 0.008 98.88);
        color: oklch(0.2768 0 0);
        border-color: oklch(0.42 0.0017 106.48);
      }
`;

export function injectOverlayStyles(): void {
  if (document.getElementById("vf-overlay-styles")) return;
  const style = document.createElement("style");
  style.id = "vf-overlay-styles";
  style.textContent = OVERLAY_CSS;
  try {
    document.head.appendChild(style);
    if (!style.sheet) {
      console.warn("[StudioBridge] Inline style injection may be blocked by CSP (style-src).");
    }
  } catch (error) {
    console.warn(
      "[StudioBridge] Failed to inject bridge styles. This may be caused by CSP style-src restrictions.",
      error,
    );
  }
}
