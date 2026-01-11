/**
 * Cross-platform terminal selection utilities with arrow key navigation
 * Supports both Deno and Node.js runtimes
 */

import { cyan, dim, green } from "@veryfront/compat/console";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

// ANSI escape codes
const CLEAR_LINE = "\x1b[2K";
const MOVE_UP = "\x1b[1A";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/**
 * Single-select with arrow key navigation
 */
export async function select(
  question: string,
  options: SelectOption[],
  defaultIndex = 0,
): Promise<string | null> {
  let selectedIndex = defaultIndex;

  // Print question
  console.log("");
  console.log(cyan("?") + " " + question);
  console.log(dim("  Use arrow keys to navigate, Enter to select"));
  console.log("");

  const renderOptions = () => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const prefix = i === selectedIndex ? green("❯") : " ";
      const label = i === selectedIndex ? green(opt.label) : opt.label;
      const desc = opt.description ? dim(` - ${opt.description}`) : "";
      console.log(`  ${prefix} ${label}${desc}`);
    }
  };

  const clearOptions = () => {
    for (let i = 0; i < options.length; i++) {
      process.stdout?.write?.(MOVE_UP + CLEAR_LINE) ??
        Deno?.stdout?.writeSync?.(new TextEncoder().encode(MOVE_UP + CLEAR_LINE));
    }
  };

  // Initial render
  process.stdout?.write?.(HIDE_CURSOR) ??
    Deno?.stdout?.writeSync?.(new TextEncoder().encode(HIDE_CURSOR));
  renderOptions();

  try {
    const result = await readKeypress((key) => {
      if (key === "up" && selectedIndex > 0) {
        selectedIndex--;
        clearOptions();
        renderOptions();
      } else if (key === "down" && selectedIndex < options.length - 1) {
        selectedIndex++;
        clearOptions();
        renderOptions();
      } else if (key === "enter") {
        return options[selectedIndex]?.value ?? null;
      } else if (key === "escape") {
        return null;
      }
      return undefined; // Continue reading
    });

    // Show final selection
    clearOptions();
    const selected = options[selectedIndex];
    if (selected) {
      console.log(`  ${green("✓")} ${selected.label}`);
    }

    return result;
  } finally {
    process.stdout?.write?.(SHOW_CURSOR) ??
      Deno?.stdout?.writeSync?.(new TextEncoder().encode(SHOW_CURSOR));
  }
}

/**
 * Multi-select with arrow key navigation and space to toggle
 */
export async function multiSelect(
  question: string,
  options: SelectOption[],
  preselected: string[] = [],
): Promise<string[]> {
  let cursorIndex = 0;
  const selected = new Set(preselected);

  // Print question
  console.log("");
  console.log(cyan("?") + " " + question);
  console.log(dim("  Use arrow keys, Space to toggle, Enter to confirm"));
  console.log("");

  const renderOptions = () => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const cursor = i === cursorIndex ? green("❯") : " ";
      const checkbox = selected.has(opt.value) ? green("◉") : "○";
      const label = i === cursorIndex ? green(opt.label) : opt.label;
      const desc = opt.description ? dim(` - ${opt.description}`) : "";
      console.log(`  ${cursor} ${checkbox} ${label}${desc}`);
    }
  };

  const clearOptions = () => {
    for (let i = 0; i < options.length; i++) {
      process.stdout?.write?.(MOVE_UP + CLEAR_LINE) ??
        Deno?.stdout?.writeSync?.(new TextEncoder().encode(MOVE_UP + CLEAR_LINE));
    }
  };

  // Initial render
  process.stdout?.write?.(HIDE_CURSOR) ??
    Deno?.stdout?.writeSync?.(new TextEncoder().encode(HIDE_CURSOR));
  renderOptions();

  try {
    await readKeypress((key) => {
      if (key === "up" && cursorIndex > 0) {
        cursorIndex--;
        clearOptions();
        renderOptions();
      } else if (key === "down" && cursorIndex < options.length - 1) {
        cursorIndex++;
        clearOptions();
        renderOptions();
      } else if (key === "space") {
        const opt = options[cursorIndex];
        if (opt) {
          selected.has(opt.value) ? selected.delete(opt.value) : selected.add(opt.value);
          clearOptions();
          renderOptions();
        }
      } else if (key === "enter") {
        return Array.from(selected);
      } else if (key === "escape") {
        return [];
      }
      return undefined; // Continue reading
    });

    // Show final selection
    clearOptions();
    for (const opt of options) {
      if (selected.has(opt.value)) {
        console.log(`  ${green("✓")} ${opt.label}`);
      }
    }
    if (selected.size === 0) {
      console.log(dim("  No items selected"));
    }

    return Array.from(selected);
  } finally {
    process.stdout?.write?.(SHOW_CURSOR) ??
      Deno?.stdout?.writeSync?.(new TextEncoder().encode(SHOW_CURSOR));
  }
}

type KeyHandler<T> = (key: string) => T | undefined;

/**
 * Read keypresses in raw mode (cross-platform)
 */
function readKeypress<T>(handler: KeyHandler<T>): Promise<T> {
  if (isDeno) {
    return readKeypressDeno(handler);
  }
  return readKeypressNode(handler);
}

/**
 * Deno implementation of keypress reading
 */
async function readKeypressDeno<T>(handler: KeyHandler<T>): Promise<T> {
  // @ts-ignore: Deno global
  Deno.stdin.setRaw(true);

  try {
    const buf = new Uint8Array(8);
    while (true) {
      // @ts-ignore: Deno global
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      const key = parseKeySequence(buf.subarray(0, n));
      const result = handler(key);
      if (result !== undefined) {
        return result;
      }
    }
    throw new Error("stdin closed");
  } finally {
    // @ts-ignore: Deno global
    Deno.stdin.setRaw(false);
  }
}

/**
 * Node.js implementation of keypress reading
 */
function readKeypressNode<T>(handler: KeyHandler<T>): Promise<T> {
  const stdin = process.stdin;

  return new Promise((resolve, reject) => {
    // Save original settings
    const wasRaw = stdin.isRaw;

    // Set raw mode
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    const onData = (data: Uint8Array) => {
      const key = parseKeySequence(data);
      const result = handler(key);
      if (result !== undefined) {
        cleanup();
        resolve(result);
      }
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("stdin closed"));
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      if (stdin.setRawMode) {
        stdin.setRawMode(wasRaw ?? false);
      }
      stdin.pause();
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

/**
 * Parse raw key sequence into key name
 */
function parseKeySequence(buf: Uint8Array): string {
  // Handle escape sequences
  if (buf[0] === 0x1b) {
    if (buf[1] === 0x5b) {
      // CSI sequences
      switch (buf[2]) {
        case 0x41:
          return "up";
        case 0x42:
          return "down";
        case 0x43:
          return "right";
        case 0x44:
          return "left";
      }
    }
    return "escape";
  }

  // Handle single characters
  switch (buf[0]) {
    case 0x0d: // Enter
    case 0x0a: // Line feed
      return "enter";
    case 0x20: // Space
      return "space";
    case 0x03: // Ctrl+C
      return "ctrl-c";
    case 0x71: // q
      return "q";
  }

  return "unknown";
}
