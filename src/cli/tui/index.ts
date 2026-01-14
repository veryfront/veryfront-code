/**
 * Veryfront TUI
 *
 * Premium Terminal User Interface for Veryfront CLI.
 *
 * @example
 * ```ts
 * import { TUIRenderer, defaultTheme, renderProgressBar, writeStatusBar } from "@veryfront/cli/tui";
 *
 * const renderer = new TUIRenderer({ theme: defaultTheme });
 * renderer.init();
 *
 * // Draw UI
 * renderer.clear();
 * const ctx = renderer.getContext();
 * // ... draw to buffer
 * renderer.commit();
 *
 * // Cleanup
 * renderer.cleanup();
 * ```
 */

// Core
export {
  batch,
  blue,
  bold,
  box,
  BOX_CHARS,
  type Cell,
  clearLine,
  clearScreen,
  column,
  type ComputedLayout,
  // Layout
  computeLayout,
  createComputed,
  createEffect,
  // State
  createSignal,
  createStore,
  cursorHide,
  cursorShow,
  cursorTo,
  cyan,
  destroyRenderer,
  dim,
  enterAltScreen,
  exitAltScreen,
  getRenderer,
  gray,
  green,
  italic,
  type LayoutNode,
  type LayoutStyle,
  magenta,
  type ReadonlySignal,
  // ANSI
  red,
  type RenderContext,
  row,
  type Signal,
  spacer,
  SYMBOLS,
  text as layoutText,
  // Renderer
  TUIRenderer,
  underline,
  white,
  withChildren,
  write,
  writeLine,
  yellow,
} from "./core/index.ts";

// Components
export {
  type BoxProps,
  commandItem,
  createBox,
  createSpinnerController,
  // Box
  drawBox,
  drawHDivider,
  drawVDivider,
  gitBranchItem,
  helpItem,
  type ProgressBarProps,
  projectItem,
  // Progress
  renderProgressBar,
  renderSpinner,
  // Status Bar
  renderStatusBar,
  renderTaskItem,
  // Text
  renderText,
  shortcutItem,
  type StatusBarItem,
  type StatusBarProps,
  statusItem,
  type TaskItem,
  type TaskStatus,
  text,
  type TextProps,
  timeItem,
  withBorder,
  withTitle,
  writeProgressBar,
  writeStatusBar,
  writeText,
} from "./components/index.ts";

// Themes
export {
  ASCII_SYMBOLS,
  BORDER_CHARS,
  colorblindTheme,
  type ColorPalette,
  createLightVariant,
  createTheme,
  DEFAULT_SYMBOLS,
  defaultTheme,
  detectTheme,
  getTheme,
  getThemeNames,
  registerTheme,
  snazzyTheme,
  type SymbolSet,
  type SyntaxColors,
  type Theme,
  type ThemeConfig,
} from "./themes/index.ts";

// Utils
export {
  createKeyboardStream,
  disableRawMode,
  enableRawMode,
  getTerminalCapabilities,
  getTerminalSize,
  isStderrTTY,
  isTTY,
  type KeyEvent,
  onResize,
  parseKeyPress,
  type TerminalCapabilities,
  type TerminalSize,
} from "./utils/terminal.ts";

export {
  charWidth,
  padToWidth,
  splitAtWidth,
  stringWidth,
  truncateToWidth,
  wrapText,
} from "./utils/unicode.ts";
