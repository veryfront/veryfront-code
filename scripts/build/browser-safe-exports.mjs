export const BROWSER_SAFE_EXPORTS = [
  // Client/SSR-safe mirror of the root barrel (server bootstrap surface removed).
  // The import rewriter redirects `veryfront` here for browser/ssr; it must ship
  // in the npm package (built to esm/src/index.client.js) or that redirect 404s.
  "./index.client",
  "./head",
  "./router",
  "./context",
  "./fonts",
  "./ui",
  "./ui/icons",
  "./chat",
  "./chat/ag-ui",
  "./chat/protocol",
  "./chat/types",
  "./chat/message-prep",
  "./markdown",
  "./mdx",
  "./agent/identity",
];

export const BROWSER_SAFE_DNT_TIMER_MODULES = [
  "src/agent/hosted/chat-execution-runtime.js",
  "src/agent/hosted/child-stream-watchdog.js",
  "src/chat/final-step-fallback.js",
];

export const BROWSER_SAFE_CLIENT_MODULES = [
  // Demoted from public exports in #2350 but still browser-consumed via the
  // ./chat barrel, so they keep the polyfill-stripping treatment by path.
  "src/chat/conversation.js",
  "src/chat/provider-errors.js",
  "src/agent/react/use-voice-input.js",
  "src/react/components/chat/chat/components/code-block.js",
  "src/react/components/chat/chat/components/inline-citation.js",
  "src/react/components/chat/chat/components/message-actions.js",
  "src/react/components/chat/chat/components/reasoning.js",
  "src/react/components/ui/color-mode.js",
  "src/react/runtime/core.js",
  "src/security/client/html-sanitizer.js",
  "src/platform/compat/runtime.js",
  "src/workflow/react/index.js",
  "src/workflow/react/use-approval.js",
  "src/workflow/react/use-workflow.js",
  "src/workflow/react/use-workflow-list.js",
  "src/workflow/react/use-workflow-start.js",
];
