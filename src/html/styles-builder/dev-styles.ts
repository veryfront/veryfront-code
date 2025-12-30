import { Z_INDEX_ERROR_OVERLAY } from "@veryfront/utils";

/**
 * Dev-mode specific styles
 *
 * Note: Tailwind utility classes are now handled by Tailwind CDN in development mode.
 * This file only contains dev-specific UI styles (error overlay).
 */
export function getDevStyles(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <style${nonceAttr}>
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
