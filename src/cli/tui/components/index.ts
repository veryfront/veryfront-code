/**
 * TUI Components
 *
 * Export all components for the TUI system.
 */

// Primitives
export {
  renderText,
  text,
  type TextProps,
  type TextRenderResult,
  type TextStyle,
  writeText,
} from "./primitives/text.ts";

export {
  atPosition,
  type BorderStyle,
  type BoxProps,
  type BoxStyle,
  createBox,
  drawBox,
  drawHDivider,
  drawVDivider,
  withBackground,
  withBorder,
  withTitle,
} from "./primitives/box.ts";

// Display
export {
  createSpinnerController,
  type ProgressBarProps,
  type ProgressBarStyle,
  renderProgressBar,
  renderSpinner,
  renderTaskItem,
  type SpinnerProps,
  type TaskItem,
  type TaskStatus,
  writeProgressBar,
} from "./display/progress-bar.ts";

export {
  commandItem,
  gitBranchItem,
  helpItem,
  projectItem,
  renderStatusBar,
  shortcutItem,
  type StatusBarItem,
  type StatusBarProps,
  statusItem,
  timeItem,
  writeStatusBar,
} from "./display/status-bar.ts";
