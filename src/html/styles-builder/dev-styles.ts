import { Z_INDEX_ERROR_OVERLAY } from "#veryfront/utils";

export function getDevStyles(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `
  <style${nonceAttr}>
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

    @view-transition {
      navigation: auto;
    }

    ::view-transition-old(root),
    ::view-transition-new(root) {
      animation-duration: 0.2s;
      animation-timing-function: ease-out;
    }

    ::view-transition-old(root) {
      animation-name: vf-fade-out;
    }

    ::view-transition-new(root) {
      animation-name: vf-fade-in;
    }

    @keyframes vf-fade-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @keyframes vf-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  </style>`;
}
