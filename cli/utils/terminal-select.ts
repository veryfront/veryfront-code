/**
 * Cross-platform terminal selection utilities with arrow key navigation
 * Supports both Deno and Node.js runtimes
 */

import { brand, muted } from "#cli/ui";
import { writeStdout } from "veryfront/platform";
import { isDeno } from "veryfront/platform";
import { getStdinReader, setRawMode } from "veryfront/platform";

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

function clearOptions(count: number): void {
  for (let i = 0; i < count; i++) {
    writeStdout(MOVE_UP + CLEAR_LINE);
  }
}

/**
 * Single-select with arrow key navigation
 */
export async function select(
  question: string,
  options: SelectOption[],
  defaultIndex = 0,
): Promise<string | null> {
  let selectedIndex = defaultIndex;

  console.log("");
  console.log(brand("?") + " " + question);
  console.log(muted("  Use arrow keys to navigate, Enter to select"));
  console.log("");

  function renderOptions(): void {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;

      const isSelected = i === selectedIndex;
      const prefix = isSelected ? brand("❯") : " ";
      const label = isSelected ? brand(opt.label) : opt.label;
      const desc = opt.description ? muted(` - ${opt.description}`) : "";
      console.log(`  ${prefix} ${label}${desc}`);
    }
  }

  writeStdout(HIDE_CURSOR);
  renderOptions();

  try {
    const result = await readKeypress((key) => {
      if (key === "up") {
        if (selectedIndex <= 0) return undefined;
        selectedIndex--;
        clearOptions(options.length);
        renderOptions();
        return undefined;
      }

      if (key === "down") {
        if (selectedIndex >= options.length - 1) return undefined;
        selectedIndex++;
        clearOptions(options.length);
        renderOptions();
        return undefined;
      }

      if (key === "enter") return options[selectedIndex]?.value ?? null;
      if (key === "escape") return null;

      return undefined;
    });

    clearOptions(options.length);
    const selected = options[selectedIndex];
    if (selected) console.log(`  ${brand("✓")} ${selected.label}`);

    return result;
  } finally {
    writeStdout(SHOW_CURSOR);
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

  console.log("");
  console.log(brand("?") + " " + question);
  console.log(muted("  Use arrow keys, Space to toggle, Enter to confirm"));
  console.log("");

  function renderOptions(): void {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;

      const isCursor = i === cursorIndex;
      const cursor = isCursor ? brand("❯") : " ";
      const checkbox = selected.has(opt.value) ? brand("◉") : "○";
      const label = isCursor ? brand(opt.label) : opt.label;
      const desc = opt.description ? muted(` - ${opt.description}`) : "";
      console.log(`  ${cursor} ${checkbox} ${label}${desc}`);
    }
  }

  writeStdout(HIDE_CURSOR);
  renderOptions();

  try {
    await readKeypress((key) => {
      if (key === "up") {
        if (cursorIndex <= 0) return undefined;
        cursorIndex--;
        clearOptions(options.length);
        renderOptions();
        return undefined;
      }

      if (key === "down") {
        if (cursorIndex >= options.length - 1) return undefined;
        cursorIndex++;
        clearOptions(options.length);
        renderOptions();
        return undefined;
      }

      if (key === "space") {
        const opt = options[cursorIndex];
        if (!opt) return undefined;

        if (selected.has(opt.value)) selected.delete(opt.value);
        else selected.add(opt.value);

        clearOptions(options.length);
        renderOptions();
        return undefined;
      }

      if (key === "enter") return Array.from(selected);
      if (key === "escape") return [];

      return undefined;
    });

    clearOptions(options.length);
    for (const opt of options) {
      if (selected.has(opt.value)) console.log(`  ${brand("✓")} ${opt.label}`);
    }
    if (selected.size === 0) console.log(muted("  No items selected"));

    return Array.from(selected);
  } finally {
    writeStdout(SHOW_CURSOR);
  }
}

/**
 * Text input with cursor editing
 */
export async function textInput(
  question: string,
  defaultValue = "",
): Promise<string | null> {
  let value = defaultValue;
  let cursorPos = value.length;

  console.log("");
  console.log(brand("?") + " " + question);
  console.log(muted("  Type your answer, Enter to submit, Esc to cancel"));
  console.log("");

  function renderInput(): void {
    const beforeCursor = value.slice(0, cursorPos);
    const cursorChar = value[cursorPos] ?? " ";
    const afterCursor = value.slice(cursorPos + 1);
    const cursor = `\x1b[7m${cursorChar}\x1b[27m`; // inverse video
    console.log(`  ${brand(">")} ${beforeCursor}${cursor}${afterCursor}`);
  }

  writeStdout(HIDE_CURSOR);
  renderInput();

  try {
    const result = await readKeypress((key) => {
      // Handle escape
      if (key === "escape") return null;

      // Handle enter
      if (key === "enter") return value;

      // Handle backspace
      if (key === "backspace") {
        if (cursorPos > 0) {
          value = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          cursorPos--;
          clearOptions(1);
          renderInput();
        }
        return undefined;
      }

      // Handle left/right arrow
      if (key === "left") {
        if (cursorPos > 0) {
          cursorPos--;
          clearOptions(1);
          renderInput();
        }
        return undefined;
      }

      if (key === "right") {
        if (cursorPos < value.length) {
          cursorPos++;
          clearOptions(1);
          renderInput();
        }
        return undefined;
      }

      // Handle character input
      if (key.startsWith("char:")) {
        const char = key.slice(5);
        value = value.slice(0, cursorPos) + char + value.slice(cursorPos);
        cursorPos++;
        clearOptions(1);
        renderInput();
        return undefined;
      }

      return undefined;
    });

    clearOptions(1);
    if (result !== null) {
      console.log(`  ${brand("✓")} ${result}`);
    } else {
      console.log(muted("  Cancelled"));
    }

    return result;
  } finally {
    writeStdout(SHOW_CURSOR);
  }
}

type KeyHandler<T> = (key: string) => T | undefined;

/**
 * Read keypresses in raw mode (cross-platform)
 */
function readKeypress<T>(handler: KeyHandler<T>): Promise<T> {
  return isDeno ? readKeypressDeno(handler) : readKeypressNode(handler);
}

/**
 * Deno implementation of keypress reading (using platform abstraction)
 */
async function readKeypressDeno<T>(handler: KeyHandler<T>): Promise<T> {
  setRawMode(true);
  const reader = getStdinReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;

      const result = handler(parseKeySequence(value));
      if (result !== undefined) return result;
    }
    throw new Error("stdin closed");
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}

/**
 * Node.js implementation of keypress reading
 */
function readKeypressNode<T>(handler: KeyHandler<T>): Promise<T> {
  const stdin = process.stdin;

  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;

    stdin.setRawMode?.(true);
    stdin.resume();

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (data: Uint8Array): void => {
      const result = handler(parseKeySequence(data));
      if (result === undefined) return;
      cleanup();
      resolve(result);
    };

    const onEnd = (): void => {
      cleanup();
      reject(new Error("stdin closed"));
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

/**
 * Parse raw key sequence into key name
 */
function parseKeySequence(buf: Uint8Array): string {
  if (buf[0] === 0x1b) {
    if (buf[1] === 0x5b) {
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

  switch (buf[0]) {
    case 0x0d:
    case 0x0a:
      return "enter";
    case 0x20:
      return "space";
    case 0x03:
      return "ctrl-c";
    case 0x7f: // DEL (backspace on most terminals)
    case 0x08: // BS
      return "backspace";
  }

  // Printable ASCII characters
  if (buf[0] && buf[0] >= 0x20 && buf[0] <= 0x7e) {
    return `char:${String.fromCharCode(buf[0])}`;
  }

  return "unknown";
}
