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
  // The Agent Events Protocol parser and schema-derived contract. API, Code,
  // and Studio consume it in browser bundles with an injected schema adapter.
  "./events",
  // Minimal public AG-UI interoperability entrypoint for API/Studio adapters.
  "./events/ag-ui",
  // The typed run event contract. Studio reads a run's event log in the
  // browser bundle. The entry point is vocabulary and schemas only: no npm
  // dependency, no server module, and the single Node builtin it reaches
  // (node:async_hooks, via the contract registry) is the same one ./chat and
  // ./chat/ag-ui already reach and is rewritten to a no-op browser polyfill.
  // browser-safe-exports.test.ts pins that set so nothing worse creeps in.
  "./run-events",
];

export const BROWSER_SAFE_DNT_TIMER_MODULES = [
  "src/agent/hosted/chat-execution-runtime.js",
  "src/agent/hosted/child-stream-watchdog.js",
  "src/chat/final-step-fallback.js",
];

// Browser-consumed entrypoints may reach these dnt-emitted modules through
// normal relative imports. They are browser-compatible source modules, but dnt
// injects Node shim/polyfill imports for runtime features they do not use in
// the browser-safe graph.
export const BROWSER_SAFE_TRANSITIVE_EXPORTS = [
  "./chat/ag-ui",
  "./run-events",
  "./events/ag-ui",
];

export const BROWSER_SAFE_TRANSITIVE_MODULES = [
  "src/extensions/contracts.js",
  "src/schemas/index.js",
  "src/platform/compat/process/env.js",
  "src/platform/compat/process/lifecycle.js",
  "src/platform/compat/process/runtime-process.js",
  "src/platform/compat/process/scoped-process-env.js",
  "src/utils/constants/cache.js",
];

export const BROWSER_SAFE_CLIENT_MODULES = [
  // Demoted from public exports in #2350 but still browser-consumed via the
  // ./chat barrel, so they keep the polyfill-stripping treatment by path.
  "src/chat/conversation.js",
  "src/chat/provider-errors.js",
  "src/agent/react/use-voice-input.js",
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
