// Dnt must compile these modules even though they are implementation details,
// not public package subpaths. The npm build removes their temporary dnt
// export entries after compilation.
export const BROWSER_SAFE_INTERNAL_ENTRY_POINTS = Object.freeze({
  "./index.client": "./src/index.client.ts",
});

/**
 * Compose dnt entry points without allowing a build-only implementation detail
 * to shadow a supported public package subpath.
 *
 * @param {Readonly<Record<string, string>>} publicEntryPoints
 * @param {Readonly<Record<string, string>>} internalEntryPoints
 * @returns {Array<{ name: string; path: string }>}
 */
export function createDntEntryPoints(publicEntryPoints, internalEntryPoints) {
  for (const name of Object.keys(internalEntryPoints)) {
    if (Object.hasOwn(publicEntryPoints, name)) {
      throw new Error(
        `Dnt entry point ${name} cannot be both public and internal`,
      );
    }
  }

  return [...Object.entries(publicEntryPoints), ...Object.entries(internalEntryPoints)]
    .map(([name, path]) => ({ name, path }));
}

export const BROWSER_SAFE_EXPORTS = [
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
  "src/security/client/html-sanitizer.js",
  "src/platform/compat/runtime.js",
  "src/workflow/react/index.js",
  "src/workflow/react/use-approval.js",
  "src/workflow/react/use-workflow.js",
  "src/workflow/react/use-workflow-list.js",
  "src/workflow/react/use-workflow-start.js",
];
