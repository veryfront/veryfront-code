import { Z_INDEX_DEV_INDICATOR, Z_INDEX_ERROR_OVERLAY } from "@veryfront/utils";

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
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      z-index: ${Z_INDEX_DEV_INDICATOR};
    }
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

    /* Tailwind Preflight - Base Styles */
    *, ::before, ::after {
      box-sizing: border-box;
      border-width: 0;
      border-style: solid;
      border-color: #e5e7eb;
    }

    html {
      line-height: 1.5;
      -webkit-text-size-adjust: 100%;
      -moz-tab-size: 4;
      tab-size: 4;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    }

    body {
      margin: 0;
      line-height: inherit;
    }

    /* Tailwind Utility Classes - Layout */
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .items-center { align-items: center; }
    .justify-center { justify-content: center; }
    .justify-between { justify-content: space-between; }
    .gap-2 { gap: 0.5rem; }
    .gap-4 { gap: 1rem; }
    .gap-6 { gap: 1.5rem; }

    /* Spacing */
    .p-2 { padding: 0.5rem; }
    .p-3 { padding: 0.75rem; }
    .p-4 { padding: 1rem; }
    .p-6 { padding: 1.5rem; }
    .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
    .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
    .mb-1 { margin-bottom: 0.25rem; }
    .mb-4 { margin-bottom: 1rem; }
    .mb-8 { margin-bottom: 2rem; }

    /* Sizing */
    .w-full { width: 100%; }
    .h-full { height: 100%; }
    .min-h-screen { min-height: 100vh; }
    .max-w-4xl { max-width: 56rem; }
    .max-h-96 { max-height: 24rem; }
    .flex-1 { flex: 1 1 0%; }

    /* Colors - Backgrounds */
    .bg-slate-900 { background-color: rgb(15 23 42); }
    .bg-slate-800 { background-color: rgb(30 41 59); }
    .bg-slate-700 { background-color: rgb(51 65 85); }
    .bg-blue-600 { background-color: rgb(37 99 235); }
    .bg-blue-700 { background-color: rgb(29 78 216); }
    .hover\\:bg-blue-700:hover { background-color: rgb(29 78 216); }
    .hover\\:bg-slate-700:hover { background-color: rgb(51 65 85); }

    /* Colors - Text */
    .text-white { color: rgb(255 255 255); }
    .text-gray-400 { color: rgb(156 163 175); }
    .text-slate-400 { color: rgb(148 163 184); }

    /* Typography */
    .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
    .text-xs { font-size: 0.75rem; line-height: 1rem; }
    .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
    .text-2xl { font-size: 1.5rem; line-height: 2rem; }
    .font-medium { font-weight: 500; }

    /* Border */
    .rounded { border-radius: 0.25rem; }
    .rounded-lg { border-radius: 0.5rem; }
    .border { border-width: 1px; }
    .border-slate-700 { border-color: rgb(51 65 85); }

    /* Effects */
    .shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
    .overflow-y-auto { overflow-y: auto; }

    /* Interactive */
    .transition-colors { transition-property: color, background-color, border-color; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    .cursor-pointer { cursor: pointer; }
    .disabled\\:opacity-50:disabled { opacity: 0.5; }
    .disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }

    /* Animations - Bounce with Delays (CSP-compliant) */
    .animate-bounce-delay-200 {
      animation: bounce 1s infinite;
      animation-delay: 0.2s;
    }
    .animate-bounce-delay-400 {
      animation: bounce 1s infinite;
      animation-delay: 0.4s;
    }
    @keyframes bounce {
      0%, 100% {
        transform: translateY(-25%);
        animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
      }
      50% {
        transform: translateY(0);
        animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
      }
    }

    /* Forms */
    input, textarea, select {
      font-family: inherit;
      font-size: 100%;
      line-height: inherit;
      color: inherit;
      margin: 0;
      padding: 0;
    }

    input:focus, textarea:focus {
      outline: 2px solid transparent;
      outline-offset: 2px;
    }
  </style>`;
}
