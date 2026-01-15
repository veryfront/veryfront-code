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

// Key codes for raw mode
const CTRL_C = 0x03;
const ENTER_CR = 0x0d;
const ENTER_LF = 0x0a;

/**
 * Wait for Enter key or Ctrl+C.
 * Returns true if Enter was pressed (continue), false if Ctrl+C (exit).
 * Works in both Deno and Node.js.
 */
export function waitForEnterOrExit(): Promise<boolean> {
  return new Promise((resolve) => {
    // Deno
    if (typeof Deno !== "undefined" && Deno.stdin) {
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      const readKey = async () => {
        const { value } = await reader.read();
        if (value && value.length > 0) {
          const key = value[0];
          if (key === CTRL_C) {
            Deno.stdin.setRaw(false);
            reader.releaseLock();
            resolve(false);
            return;
          }
          if (key === ENTER_CR || key === ENTER_LF) {
            Deno.stdin.setRaw(false);
            reader.releaseLock();
            resolve(true);
            return;
          }
          // Other key - keep waiting
          readKey();
        }
      };
      readKey();
      return;
    }

    // Node.js
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const onData = (data: Uint8Array) => {
      const key = data[0];
      if (key === CTRL_C) {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        resolve(false);
        return;
      }
      if (key === ENTER_CR || key === ENTER_LF) {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        resolve(true);
        return;
      }
      // Other key - keep listening
    };

    process.stdin.on("data", onData);
  });
}
