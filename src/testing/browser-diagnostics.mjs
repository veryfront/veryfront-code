const HYDRATION_OR_CSP_FAILURE_PATTERNS = [
  "Page hydration failed",
  "unsafe-eval",
  "Failed to fetch dynamically imported module",
  "WebAssembly.compile()",
  "Content Security Policy",
  "violates the following Content Security Policy directive",
  "Refused to load the script",
  "Hydration",
];

/**
 * Find browser hydration and CSP failures without loading a browser runtime.
 * @param {string[]} messages
 * @returns {string[]}
 */
export function findHydrationOrCspFailures(messages) {
  return messages.filter((message) =>
    HYDRATION_OR_CSP_FAILURE_PATTERNS.some((pattern) => message.includes(pattern))
  );
}
