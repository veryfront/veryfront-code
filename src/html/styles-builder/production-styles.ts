import {
  BREAKPOINT_LG,
  BREAKPOINT_MD,
  BREAKPOINT_SM,
  BREAKPOINT_XL,
  PROSE_MAX_WIDTH,
} from "#veryfront/utils";

export function getProductionStyles(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `
  <style${nonceAttr}>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.5;
    }

    .prose {
      max-width: 65ch;
      margin: 0 auto;
      padding: 2rem;
    }

    .prose h1, .prose h2, .prose h3 {
      margin-top: 2em;
      margin-bottom: 1em;
    }

    .prose p {
      margin-bottom: 1.5em;
    }

    .prose code {
      background: #f3f4f6;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.875em;
    }

    .prose pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 1em;
      border-radius: 8px;
      overflow-x: auto;
    }

    .prose pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }

    .vf-tailwind {
      width: 100%;
    }

    .container {
      width: 100%;
      margin-right: auto;
      margin-left: auto;
      padding-right: 1rem;
      padding-left: 1rem;
    }

    @media (min-width: ${BREAKPOINT_SM}px) { .container { max-width: ${BREAKPOINT_SM}px; } }
    @media (min-width: ${BREAKPOINT_MD}px) { .container { max-width: ${BREAKPOINT_MD}px; } }
    @media (min-width: ${BREAKPOINT_LG}px) { .container { max-width: ${BREAKPOINT_LG}px; } }
    @media (min-width: ${BREAKPOINT_XL}px) { .container { max-width: ${BREAKPOINT_XL}px; } }

    .mx-auto {
      margin-left: auto;
      margin-right: auto;
    }

    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-8 { padding-top: 2rem; padding-bottom: 2rem; }

    .max-w-4xl { max-width: ${PROSE_MAX_WIDTH}; }
  </style>`;
}
