/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    // Deno
    if (typeof Deno !== "undefined" && Deno.stdin) {
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      reader.read().then(() => {
        Deno.stdin.setRaw(false);
        reader.releaseLock();
        resolve();
      });
      return;
    }

    // Node.js
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}
