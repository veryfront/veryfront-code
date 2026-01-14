/**
 * TUI Core
 *
 * Export core TUI functionality including rendering, layout, and state.
 */

// ANSI utilities
export {
  ASCII_SYMBOLS,
  bg256,
  bgHex,
  bgRgb,
  blink,
  blue,
  bold,
  // Constants
  BOX_CHARS,
  center,
  clearAll,
  clearLine,
  clearLineLeft,
  clearLineRight,
  // Screen control
  clearScreen,
  clearScreenDown,
  clearScreenUp,
  colors,
  cursorBack,
  cursorDown,
  cursorForward,
  // Cursor control
  cursorHide,
  cursorHome,
  cursorRestore,
  cursorSave,
  cursorShow,
  cursorTo,
  cursorToColumn,
  cursorUp,
  cyan,
  dim,
  drawBox,
  enterAltScreen,
  exitAltScreen,
  // 256/true color
  fg256,
  fgHex,
  fgRgb,
  flush,
  gray,
  green,
  hidden,
  // Extended formatting
  inverse,
  italic,
  magenta,
  padEnd,
  padStart,
  // Colors (re-exported from compat)
  red,
  reset,
  scrollDown,
  scrollUp,
  strikethrough,
  // Utilities
  stripAnsi,
  SYMBOLS,
  truncate,
  underline,
  visibleLength,
  white,
  write,
  writeAt,
  writeLine,
  yellow,
} from "./ansi.ts";

// Renderer
export {
  type Cell,
  destroyRenderer,
  getRenderer,
  type RenderContext,
  type RenderOptions,
  TUIRenderer,
} from "./renderer.ts";

// Layout
export {
  type AlignItems,
  box,
  column,
  type ComputedLayout,
  computeLayout,
  type FlexDirection,
  type JustifyContent,
  type LayoutNode,
  type LayoutStyle,
  row,
  spacer,
  text,
  withChildren,
} from "./layout/yoga-lite.ts";

// State
export {
  batch,
  type Cleanup,
  createComputed,
  createDebounced,
  createEffect,
  createMemo,
  createReducer,
  createSignal,
  createStore,
  createThrottled,
  createToggle,
  type ReadonlySignal,
  type Signal,
  type Subscriber,
} from "./state/signals.ts";
