import { Z_INDEX_DEV_INDICATOR, Z_INDEX_ERROR_OVERLAY } from "@veryfront/utils";

/**
 * Dev-mode specific styles
 *
 * Note: Tailwind utility classes are now handled by Tailwind CDN in development mode.
 * This file only contains dev-specific UI styles (error overlay, dev indicators).
 */
export function getDevStyles(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <style${nonceAttr}>
    /* Dev-mode indicators */
    .dev-indicator {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: #3b82f6;
      color: white;
      padding: 0.5rem 0.75rem 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      z-index: ${Z_INDEX_DEV_INDICATOR};
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dev-indicator-close {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 1.25rem;
      line-height: 1;
      padding: 0 0.25rem;
      opacity: 0.7;
      transition: opacity 0.15s;
    }
    .dev-indicator-close:hover {
      opacity: 1;
    }

    /* Error overlay */
    #veryfront-error-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: ${Z_INDEX_ERROR_OVERLAY};
      background: rgba(0,0,0,0.85);
      color: white;
      font-family: monospace;
      overflow: auto;
      padding: 2rem;
    }

    /* Custom animations for dev UI (CSP-compliant) */
    .animate-bounce-delay-200 {
      animation: vf-bounce 1s infinite;
      animation-delay: 0.2s;
    }
    .animate-bounce-delay-400 {
      animation: vf-bounce 1s infinite;
      animation-delay: 0.4s;
    }
    @keyframes vf-bounce {
      0%, 100% {
        transform: translateY(-25%);
        animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
      }
      50% {
        transform: translateY(0);
        animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
      }
    }
  </style>`;
}
