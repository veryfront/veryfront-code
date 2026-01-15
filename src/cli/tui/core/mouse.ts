/**
 * Mouse event handling for TUI
 *
 * Implements SGR1006 mouse protocol for modern terminal support.
 * Provides mouse tracking, click detection, and scroll wheel support.
 *
 * @module cli/tui/core/mouse
 */

// ============================================================================
// Constants
// ============================================================================

const ESC = "\x1b";
const CSI = `${ESC}[`;

/** Enable SGR1006 mouse tracking (modern terminals) */
export const enableMouse = `${CSI}?1000h${CSI}?1006h`;

/** Disable mouse tracking */
export const disableMouse = `${CSI}?1000l${CSI}?1006l`;

/** Enable mouse motion tracking (reports all mouse movement) */
export const enableMouseMotion = `${CSI}?1003h${CSI}?1006h`;

/** Disable mouse motion tracking */
export const disableMouseMotion = `${CSI}?1003l${CSI}?1006l`;

// ============================================================================
// Types
// ============================================================================

export type MouseButton = "left" | "middle" | "right" | "none" | "scrollUp" | "scrollDown";

export type MouseEventType = "press" | "release" | "move" | "drag";

export interface MouseEvent {
  type: MouseEventType;
  button: MouseButton;
  x: number; // 1-indexed column
  y: number; // 1-indexed row
  modifiers: {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
  };
}

export interface HitArea {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
  onClick?: () => void;
}

// ============================================================================
// Mouse Event Parsing (SGR1006 Protocol)
// ============================================================================

/**
 * Parse SGR1006 mouse event from raw input
 *
 * SGR1006 format: CSI < button ; x ; y M (press) or m (release)
 * Example: \x1b[<0;10;5M = left click at column 10, row 5
 *
 * Button codes:
 * - 0: left button
 * - 1: middle button
 * - 2: right button
 * - 32+: motion with button held
 * - 64: scroll up
 * - 65: scroll down
 *
 * Modifier bits (added to button):
 * - 4: shift
 * - 8: alt/meta
 * - 16: ctrl
 */
export function parseMouseEvent(data: Uint8Array | string): MouseEvent | null {
  const str = typeof data === "string" ? data : new TextDecoder().decode(data);

  // Match SGR1006 format: \x1b[<button;x;y[Mm]
  const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) {
    return null;
  }

  const buttonCode = parseInt(match[1] ?? "0", 10);
  const x = parseInt(match[2] ?? "0", 10);
  const y = parseInt(match[3] ?? "0", 10);
  const isRelease = match[4] === "m";

  // Extract modifiers
  const shift = (buttonCode & 4) !== 0;
  const alt = (buttonCode & 8) !== 0;
  const ctrl = (buttonCode & 16) !== 0;

  // Extract base button (remove modifier bits)
  const baseButton = buttonCode & ~(4 | 8 | 16);

  // Determine button and event type
  let button: MouseButton;
  let type: MouseEventType;

  if (baseButton >= 64) {
    // Scroll events
    button = baseButton === 64 ? "scrollUp" : "scrollDown";
    type = "press";
  } else if (baseButton >= 32) {
    // Motion with button held (drag)
    const dragButton = baseButton - 32;
    button = dragButton === 0 ? "left" : dragButton === 1 ? "middle" : dragButton === 2 ? "right" : "none";
    type = "drag";
  } else {
    // Regular click
    button = baseButton === 0 ? "left" : baseButton === 1 ? "middle" : baseButton === 2 ? "right" : "none";
    type = isRelease ? "release" : "press";
  }

  return {
    type,
    button,
    x,
    y,
    modifiers: { shift, alt, ctrl },
  };
}

/**
 * Check if a mouse event is within a hit area
 */
export function isInHitArea(event: MouseEvent, area: HitArea): boolean {
  return (
    event.x >= area.x &&
    event.x < area.x + area.width &&
    event.y >= area.y &&
    event.y < area.y + area.height
  );
}

/**
 * Find the hit area that contains the mouse event
 */
export function findHitArea(event: MouseEvent, areas: HitArea[]): HitArea | null {
  // Search in reverse order (last added = topmost)
  for (let i = areas.length - 1; i >= 0; i--) {
    const area = areas[i];
    if (area && isInHitArea(event, area)) {
      return area;
    }
  }
  return null;
}

// ============================================================================
// Mouse Input Handler
// ============================================================================

export interface MouseInputHandler {
  /** Start listening for mouse events */
  start(): void;
  /** Stop listening for mouse events */
  stop(): void;
  /** Register a callback for mouse events */
  onMouse(callback: (event: MouseEvent) => void): () => void;
}

/**
 * Create a mouse input handler for Deno
 */
export function createMouseHandler(): MouseInputHandler {
  const callbacks: Set<(event: MouseEvent) => void> = new Set();
  let running = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const start = () => {
    if (running) return;
    running = true;

    // Enable mouse tracking
    if (typeof Deno !== "undefined") {
      Deno.stdout.writeSync(new TextEncoder().encode(enableMouse));
    }

    // Start reading input
    if (typeof Deno !== "undefined" && Deno.stdin.readable) {
      reader = Deno.stdin.readable.getReader();
      readLoop();
    }
  };

  const readLoop = async () => {
    if (!reader || !running) return;

    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;

        const event = parseMouseEvent(value);
        if (event) {
          for (const callback of callbacks) {
            callback(event);
          }
        }
      }
    } catch {
      // Reader was released or error occurred
    }
  };

  const stop = () => {
    running = false;

    // Disable mouse tracking
    if (typeof Deno !== "undefined") {
      Deno.stdout.writeSync(new TextEncoder().encode(disableMouse));
    }

    // Release reader
    if (reader) {
      reader.releaseLock();
      reader = null;
    }
  };

  const onMouse = (callback: (event: MouseEvent) => void): (() => void) => {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };

  return { start, stop, onMouse };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Write escape sequence to enable/disable mouse
 */
export function setMouseEnabled(enabled: boolean): void {
  if (typeof Deno !== "undefined") {
    const seq = enabled ? enableMouse : disableMouse;
    Deno.stdout.writeSync(new TextEncoder().encode(seq));
  }
}
