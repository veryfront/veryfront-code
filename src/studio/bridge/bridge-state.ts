/**
 * Bridge Shared State
 *
 * Bridge infrastructure state (inspector, console, screenshot).
 */

// ---------------------------------------------------------------------------
// Bridge infrastructure state
// ---------------------------------------------------------------------------

export const state = {
  // Inspector
  inspectMode: false,
  selectedNodeId: null as string | null,
  hoveredNodeId: null as string | null,
  lastTreeSignature: "",

  // Overlays
  hoverOverlay: null as HTMLElement | null,
  selectionOverlay: null as HTMLElement | null,

  // Console
  originalConsole: {} as Record<string, (...args: unknown[]) => void>,
  logCounter: 0,

  // Screenshot
  html2canvasLoaded: false,
  html2canvasPromise: null as Promise<void> | null,
};

export const CONSOLE_METHODS = [
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "table",
  "clear",
  "dir",
];

export const DOM_IGNORE_TAGS = ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"];
