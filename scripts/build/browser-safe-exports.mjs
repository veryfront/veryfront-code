export const BROWSER_SAFE_EXPORTS = [
  "./head",
  "./router",
  "./context",
  "./fonts",
  "./chat",
  "./chat/ag-ui",
  "./chat/protocol",
  "./chat/types",
  "./chat/conversation",
  "./chat/message-prep",
  "./chat/final-step-fallback",
  "./chat/provider-errors",
  "./markdown",
  "./mdx",
];

export const BROWSER_SAFE_DNT_TIMER_MODULES = [
  "src/chat/final-step-fallback.js",
];

export const BROWSER_SAFE_CLIENT_MODULES = [
  "src/agent/react/use-voice-input.js",
  "src/react/components/chat/chat/components/code-block.js",
  "src/react/components/chat/chat/components/inline-citation.js",
  "src/react/components/chat/chat/components/message-actions.js",
  "src/react/components/chat/chat/components/reasoning.js",
  "src/react/components/chat/chat/hooks/use-threads.js",
  "src/security/client/html-sanitizer.js",
  "src/platform/compat/runtime.js",
];
