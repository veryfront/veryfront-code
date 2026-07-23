/**
 * Bridge Styles
 * CSS injection for inspector overlays owned by the Studio bridge.
 */

import {
  createOverlayStyleElement,
  hasOverlayStyleElement,
  normalizeStyleInjectionWarningContext,
} from "./bridge-style-helpers.ts";
import { logger } from "./bridge-logger.ts";

const OVERLAY_CSS = `
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
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
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
`;

let ownedOverlayStyle: HTMLStyleElement | null = null;

export function injectOverlayStyles(nonce?: string): HTMLStyleElement | null {
  if (hasOverlayStyleElement(document, ownedOverlayStyle)) return ownedOverlayStyle;
  ownedOverlayStyle = null;
  const style = createOverlayStyleElement(document, OVERLAY_CSS, nonce);
  let appended = false;
  try {
    document.head.appendChild(style);
    appended = true;
    ownedOverlayStyle = style;
    if (!style.sheet) {
      logger.warn("Inline style injection may be blocked by CSP (style-src)");
    }
  } catch (error) {
    logger.warn(
      "Failed to inject bridge styles. This may be caused by CSP style-src restrictions.",
      normalizeStyleInjectionWarningContext(error),
    );
  }
  return appended ? style : null;
}
