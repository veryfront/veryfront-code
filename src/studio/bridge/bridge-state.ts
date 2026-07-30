/**
 * Bridge Shared State
 *
 * Bridge infrastructure state (inspector and console).
 */

// ---------------------------------------------------------------------------
// Bridge infrastructure state
// ---------------------------------------------------------------------------

export const state = {
  // Inspector
  inspectMode: false,
  selectedNodeId: null as string | null,
  hoveredNodeId: null as string | null,

  // Overlays
  hoverOverlay: null as HTMLElement | null,
  selectionOverlay: null as HTMLElement | null,

  // Console
  originalConsole: {} as Record<string, (...args: unknown[]) => void>,
  logCounter: 0,
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
