// deno-lint-ignore-file no-explicit-any
/**
 * Terminal Utilities
 *
 * Cross-runtime terminal size detection, capabilities, and configuration.
 *
 * @note Type assertions used for cross-runtime compatibility with Node.js/Bun.
 */

// Type declarations for Node.js compatibility
declare const process: any;
type Buffer = Uint8Array;

import { isDeno } from "@veryfront/platform/compat/runtime.ts";

// ============================================================================
// Types
// ============================================================================

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalCapabilities {
  /** Terminal supports colors */
  color: boolean;
  /** Terminal supports 256 colors */
  color256: boolean;
  /** Terminal supports true color (24-bit) */
  trueColor: boolean;
  /** Terminal supports Unicode */
  unicode: boolean;
  /** Terminal is interactive (TTY) */
  interactive: boolean;
  /** Terminal supports hyperlinks */
  hyperlinks: boolean;
  /** Terminal supports mouse input */
  mouse: boolean;
}

// ============================================================================
// Size Detection
// ============================================================================

/** Default terminal size if detection fails */
const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 };

/**
 * Get current terminal size
 */
export function getTerminalSize(): TerminalSize {
  try {
    if (isDeno) {
      // @ts-ignore - Deno global
      if (typeof Deno !== "undefined" && Deno.consoleSize) {
        // @ts-ignore - Deno global
        const size = Deno.consoleSize();
        return { columns: size.columns, rows: size.rows };
      }
    }

    // Node.js/Bun
    if (typeof process !== "undefined" && process.stdout) {
      const columns = process.stdout.columns;
      const rows = process.stdout.rows;
      if (columns && rows) {
        return { columns, rows };
      }
    }
  } catch {
    // Fallback to default
  }

  return DEFAULT_SIZE;
}

/**
 * Subscribe to terminal resize events
 */
export function onResize(callback: (size: TerminalSize) => void): () => void {
  if (isDeno) {
    // Deno doesn't have a built-in resize event, poll instead
    let lastSize = getTerminalSize();
    const interval = setInterval(() => {
      const newSize = getTerminalSize();
      if (newSize.columns !== lastSize.columns || newSize.rows !== lastSize.rows) {
        lastSize = newSize;
        callback(newSize);
      }
    }, 100);
    return () => clearInterval(interval);
  }

  // Node.js/Bun
  if (typeof process !== "undefined" && process.stdout?.on) {
    const handler = () => callback(getTerminalSize());
    process.stdout.on("resize", handler);
    return () => process.stdout?.off?.("resize", handler);
  }

  return () => {};
}

// ============================================================================
// Capability Detection
// ============================================================================

/**
 * Detect terminal capabilities
 */
export function getTerminalCapabilities(): TerminalCapabilities {
  const isInteractive = isTTY();
  const termProgram = getEnv("TERM_PROGRAM") || "";
  const term = getEnv("TERM") || "";
  const colorTerm = getEnv("COLORTERM") || "";

  return {
    color: detectColorSupport(),
    color256: detect256ColorSupport(term),
    trueColor: detectTrueColorSupport(colorTerm, termProgram),
    unicode: detectUnicodeSupport(term, termProgram),
    interactive: isInteractive,
    hyperlinks: detectHyperlinkSupport(termProgram),
    mouse: isInteractive, // Most modern terminals support mouse
  };
}

/**
 * Check if stdout is a TTY
 */
export function isTTY(): boolean {
  if (isDeno) {
    // @ts-ignore - Deno global
    return typeof Deno !== "undefined" && Deno.stdout?.isTerminal?.() === true;
  }
  return typeof process !== "undefined" && process.stdout?.isTTY === true;
}

/**
 * Check if stderr is a TTY
 */
export function isStderrTTY(): boolean {
  if (isDeno) {
    // @ts-ignore - Deno global
    return typeof Deno !== "undefined" && Deno.stderr?.isTerminal?.() === true;
  }
  return typeof process !== "undefined" && process.stderr?.isTTY === true;
}

// ============================================================================
// Environment Helpers
// ============================================================================

function getEnv(name: string): string | undefined {
  if (isDeno) {
    // @ts-ignore - Deno global
    return Deno.env?.get?.(name);
  }
  return process?.env?.[name];
}

function detectColorSupport(): boolean {
  // NO_COLOR takes precedence
  const noColor = getEnv("NO_COLOR");
  if (noColor !== undefined && noColor !== "") {
    return false;
  }

  // FORCE_COLOR enables color
  const forceColor = getEnv("FORCE_COLOR");
  if (forceColor !== undefined && forceColor !== "0") {
    return true;
  }

  // Check if TTY
  return isTTY();
}

function detect256ColorSupport(term: string): boolean {
  if (term.includes("256color")) return true;
  if (term === "xterm-256color") return true;
  return false;
}

function detectTrueColorSupport(colorTerm: string, termProgram: string): boolean {
  if (colorTerm === "truecolor" || colorTerm === "24bit") return true;
  if (termProgram === "iTerm.app") return true;
  if (termProgram === "Apple_Terminal") return true;
  if (termProgram === "Hyper") return true;
  if (termProgram === "vscode") return true;
  return false;
}

function detectUnicodeSupport(term: string, termProgram: string): boolean {
  // Most modern terminals support Unicode
  if (termProgram) return true;

  // Check LANG environment
  const lang = getEnv("LANG") || "";
  if (lang.toLowerCase().includes("utf")) return true;

  // Default: assume Unicode support unless TERM is dumb
  return term !== "dumb";
}

function detectHyperlinkSupport(termProgram: string): boolean {
  const supported = ["iTerm.app", "Hyper", "vscode", "WezTerm", "kitty"];
  return supported.includes(termProgram);
}

// ============================================================================
// Raw Mode
// ============================================================================

let rawModeEnabled = false;

/**
 * Enable raw mode for capturing individual keypresses
 */
export function enableRawMode(): void {
  if (rawModeEnabled) return;

  if (isDeno) {
    // @ts-ignore - Deno global
    if (Deno.stdin?.setRaw) {
      // @ts-ignore - Deno global
      Deno.stdin.setRaw(true);
      rawModeEnabled = true;
    }
  } else if (typeof process !== "undefined" && process.stdin?.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    rawModeEnabled = true;
  }
}

/**
 * Disable raw mode
 */
export function disableRawMode(): void {
  if (!rawModeEnabled) return;

  if (isDeno) {
    // @ts-ignore - Deno global
    if (Deno.stdin?.setRaw) {
      // @ts-ignore - Deno global
      Deno.stdin.setRaw(false);
      rawModeEnabled = false;
    }
  } else if (typeof process !== "undefined" && process.stdin?.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    rawModeEnabled = false;
  }
}

/**
 * Check if raw mode is currently enabled
 */
export function isRawModeEnabled(): boolean {
  return rawModeEnabled;
}

// ============================================================================
// Keyboard Input
// ============================================================================

export interface KeyEvent {
  /** Key name or character */
  key: string;
  /** Ctrl key was pressed */
  ctrl: boolean;
  /** Alt/Option key was pressed */
  alt: boolean;
  /** Shift key was pressed */
  shift: boolean;
  /** Meta/Command key was pressed */
  meta: boolean;
  /** Raw byte sequence */
  raw: Uint8Array;
}

/**
 * Parse a raw byte sequence into a KeyEvent
 */
export function parseKeyPress(data: Uint8Array): KeyEvent {
  const event: KeyEvent = {
    key: "",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: data,
  };

  if (data.length === 0) return event;

  // Single byte
  if (data.length === 1) {
    const byte = data[0];

    // Ctrl+letter (bytes 1-26 map to Ctrl+A through Ctrl+Z)
    if (byte >= 1 && byte <= 26) {
      event.ctrl = true;
      event.key = String.fromCharCode(byte + 96); // a-z
      return event;
    }

    // Regular printable characters
    if (byte >= 32 && byte <= 126) {
      event.key = String.fromCharCode(byte);
      return event;
    }

    // Special single-byte keys
    switch (byte) {
      case 0:
        event.ctrl = true;
        event.key = " ";
        break;
      case 9:
        event.key = "tab";
        break;
      case 10:
      case 13:
        event.key = "enter";
        break;
      case 27:
        event.key = "escape";
        break;
      case 127:
        event.key = "backspace";
        break;
    }
    return event;
  }

  // Escape sequences
  if (data[0] === 27) {
    // Alt+key (ESC followed by key)
    if (data.length === 2) {
      event.alt = true;
      event.key = String.fromCharCode(data[1]);
      return event;
    }

    // CSI sequences (ESC [ ...)
    if (data[1] === 91) {
      return parseCSISequence(data, event);
    }

    // SS3 sequences (ESC O ...)
    if (data[1] === 79) {
      return parseSS3Sequence(data, event);
    }
  }

  // UTF-8 multi-byte character
  try {
    event.key = new TextDecoder().decode(data);
  } catch {
    event.key = "unknown";
  }

  return event;
}

function parseCSISequence(data: Uint8Array, event: KeyEvent): KeyEvent {
  const seq = new TextDecoder().decode(data.slice(2));

  // Arrow keys
  if (seq === "A") {
    event.key = "up";
  } else if (seq === "B") {
    event.key = "down";
  } else if (seq === "C") {
    event.key = "right";
  } else if (seq === "D") {
    event.key = "left";
  } // Home/End
  else if (seq === "H" || seq === "1~") {
    event.key = "home";
  } else if (seq === "F" || seq === "4~") {
    event.key = "end";
  } // Insert/Delete
  else if (seq === "2~") {
    event.key = "insert";
  } else if (seq === "3~") {
    event.key = "delete";
  } // Page Up/Down
  else if (seq === "5~") {
    event.key = "pageup";
  } else if (seq === "6~") {
    event.key = "pagedown";
  } // Function keys
  else if (seq.match(/^1[1-5]~/)) {
    const num = parseInt(seq.slice(0, 2), 10);
    event.key = `f${num - 10}`;
  } // Shift+Arrow
  else if (seq === "1;2A") {
    event.shift = true;
    event.key = "up";
  } else if (seq === "1;2B") {
    event.shift = true;
    event.key = "down";
  } else if (seq === "1;2C") {
    event.shift = true;
    event.key = "right";
  } else if (seq === "1;2D") {
    event.shift = true;
    event.key = "left";
  } // Ctrl+Arrow
  else if (seq === "1;5A") {
    event.ctrl = true;
    event.key = "up";
  } else if (seq === "1;5B") {
    event.ctrl = true;
    event.key = "down";
  } else if (seq === "1;5C") {
    event.ctrl = true;
    event.key = "right";
  } else if (seq === "1;5D") {
    event.ctrl = true;
    event.key = "left";
  } // Shift+Tab
  else if (seq === "Z") {
    event.shift = true;
    event.key = "tab";
  } else {
    event.key = `csi:${seq}`;
  }

  return event;
}

function parseSS3Sequence(data: Uint8Array, event: KeyEvent): KeyEvent {
  const char = data[2];

  // F1-F4
  if (char >= 80 && char <= 83) {
    event.key = `f${char - 79}`;
  } // Arrow keys (some terminals)
  else if (char === 65) {
    event.key = "up";
  } else if (char === 66) {
    event.key = "down";
  } else if (char === 67) {
    event.key = "right";
  } else if (char === 68) {
    event.key = "left";
  } else {
    event.key = `ss3:${String.fromCharCode(char)}`;
  }

  return event;
}

/**
 * Create an async iterator for keyboard events
 */
export async function* createKeyboardStream(): AsyncGenerator<KeyEvent> {
  if (!isTTY()) {
    return;
  }

  enableRawMode();

  try {
    if (isDeno) {
      // @ts-ignore - Deno global
      const reader = Deno.stdin.readable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield parseKeyPress(value);
        }
      } finally {
        reader.releaseLock();
      }
    } else if (typeof process !== "undefined") {
      // Node.js
      const stdin = process.stdin;
      stdin.resume();

      // Create async iterator from stdin events
      const events: KeyEvent[] = [];
      let resolver: ((value: KeyEvent) => void) | null = null;

      const onData = (data: Buffer) => {
        const event = parseKeyPress(new Uint8Array(data));
        if (resolver) {
          resolver(event);
          resolver = null;
        } else {
          events.push(event);
        }
      };

      stdin.on("data", onData);

      try {
        while (true) {
          if (events.length > 0) {
            yield events.shift()!;
          } else {
            yield await new Promise<KeyEvent>((resolve) => {
              resolver = resolve;
            });
          }
        }
      } finally {
        stdin.off("data", onData);
      }
    }
  } finally {
    disableRawMode();
  }
}
