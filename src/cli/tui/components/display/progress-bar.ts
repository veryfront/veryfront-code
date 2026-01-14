/**
 * Progress Bar Component
 *
 * Renders a progress bar with optional label, percentage, and count.
 */

import type { Cell } from "../../core/renderer.ts";
import type { Color, Theme } from "../../themes/types.ts";
import { SYMBOLS } from "../../core/ansi.ts";

// ============================================================================
// Types
// ============================================================================

export interface ProgressBarStyle {
  /** Filled bar character */
  filledChar?: string;
  /** Empty bar character */
  emptyChar?: string;
  /** Filled bar color */
  filledColor?: Color;
  /** Empty bar color */
  emptyColor?: Color;
  /** Show percentage */
  showPercent?: boolean;
  /** Show count (e.g., "5/10") */
  showCount?: boolean;
  /** Left bracket character */
  leftBracket?: string;
  /** Right bracket character */
  rightBracket?: string;
  /** Bracket color */
  bracketColor?: Color;
}

export interface ProgressBarProps {
  /** Current value (0-max) */
  value: number;
  /** Maximum value */
  max?: number;
  /** Total width including brackets and labels */
  width: number;
  /** Label to show before the bar */
  label?: string;
  /** Style options */
  style?: ProgressBarStyle;
}

export interface ProgressBarRenderResult {
  /** Rendered cells */
  cells: Cell[];
  /** Total width */
  width: number;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_STYLE: Required<ProgressBarStyle> = {
  filledChar: SYMBOLS.progressFilled,
  emptyChar: SYMBOLS.progressEmpty,
  filledColor: "cyan",
  emptyColor: "gray",
  showPercent: true,
  showCount: false,
  leftBracket: "[",
  rightBracket: "]",
  bracketColor: "gray",
};

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render a progress bar to cells
 */
export function renderProgressBar(
  props: ProgressBarProps,
  theme?: Theme,
): ProgressBarRenderResult {
  const {
    value,
    max = 100,
    width,
    label,
    style = {},
  } = props;

  const mergedStyle = { ...DEFAULT_STYLE, ...style };
  const {
    filledChar,
    emptyChar,
    filledColor,
    emptyColor,
    showPercent,
    showCount,
    leftBracket,
    rightBracket,
    bracketColor,
  } = mergedStyle;

  const cells: Cell[] = [];
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  // Calculate available width for the bar itself
  let barWidth = width;

  // Subtract label width
  if (label) {
    for (const char of label + " ") {
      cells.push({ char, fg: colorToString(theme?.colors.text.primary) });
    }
    barWidth -= label.length + 1;
  }

  // Subtract percentage width " 100%"
  if (showPercent) {
    barWidth -= 5;
  }

  // Subtract count width " (999/999)"
  if (showCount) {
    const countStr = ` (${value}/${max})`;
    barWidth -= countStr.length;
  }

  // Subtract brackets
  barWidth -= 2;

  // Ensure minimum bar width
  barWidth = Math.max(10, barWidth);

  // Calculate filled portion
  const filledWidth = Math.round((percent / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  // Add left bracket
  cells.push({ char: leftBracket, fg: colorToString(bracketColor) });

  // Add filled portion
  for (let i = 0; i < filledWidth; i++) {
    cells.push({ char: filledChar, fg: colorToString(filledColor) });
  }

  // Add empty portion
  for (let i = 0; i < emptyWidth; i++) {
    cells.push({ char: emptyChar, fg: colorToString(emptyColor) });
  }

  // Add right bracket
  cells.push({ char: rightBracket, fg: colorToString(bracketColor) });

  // Add percentage
  if (showPercent) {
    const percentStr = ` ${Math.round(percent).toString().padStart(3)}%`;
    for (const char of percentStr) {
      cells.push({ char, fg: colorToString(theme?.colors.text.secondary) });
    }
  }

  // Add count
  if (showCount) {
    const countStr = ` (${value}/${max})`;
    for (const char of countStr) {
      cells.push({ char, fg: colorToString(theme?.colors.text.muted), dim: true });
    }
  }

  return { cells, width: cells.length };
}

/**
 * Write progress bar to buffer
 */
export function writeProgressBar(
  buffer: Cell[][],
  x: number,
  y: number,
  props: ProgressBarProps,
  theme?: Theme,
): number {
  const { cells, width } = renderProgressBar(props, theme);

  if (y < 0 || y >= buffer.length) return 0;

  const row = buffer[y];
  if (!row) return 0;

  let col = x;
  for (const cell of cells) {
    if (col >= 0 && col < row.length) {
      row[col] = cell;
    }
    col++;
  }

  return width;
}

// ============================================================================
// Indeterminate Spinner
// ============================================================================

export interface SpinnerProps {
  /** Current frame index */
  frame: number;
  /** Message to display */
  message?: string;
  /** Spinner frames (defaults to braille) */
  frames?: string[];
  /** Spinner color */
  color?: Color;
}

/**
 * Render a spinner with optional message
 */
export function renderSpinner(props: SpinnerProps, theme?: Theme): Cell[] {
  const {
    frame,
    message,
    frames = SYMBOLS.spinnerDots,
    color,
  } = props;

  const cells: Cell[] = [];
  const spinnerChar = frames[frame % frames.length] ?? "⠋";
  const spinnerColor = colorToString(color ?? theme?.colors.primary);

  cells.push({ char: spinnerChar, fg: spinnerColor });
  cells.push({ char: " " });

  if (message) {
    for (const char of message) {
      cells.push({ char, fg: colorToString(theme?.colors.text.primary) });
    }
  }

  return cells;
}

/**
 * Create a spinner animation controller
 */
export function createSpinnerController(intervalMs = 80): {
  frame: number;
  start: () => void;
  stop: () => void;
  getFrame: () => number;
} {
  let frame = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return {
    get frame() {
      return frame;
    },
    start() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        frame = (frame + 1) % SYMBOLS.spinnerDots.length;
      }, intervalMs);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    getFrame() {
      return frame;
    },
  };
}

// ============================================================================
// Task List Progress
// ============================================================================

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface TaskItem {
  /** Task label */
  label: string;
  /** Task status */
  status: TaskStatus;
  /** Duration (for completed tasks) */
  duration?: string;
  /** Error message (for failed tasks) */
  error?: string;
}

/**
 * Render a task item line
 */
export function renderTaskItem(task: TaskItem, theme?: Theme, spinnerFrame = 0): Cell[] {
  const cells: Cell[] = [];

  // Status indicator
  let indicator: string;
  let indicatorColor: Color;

  switch (task.status) {
    case "completed":
      indicator = theme?.symbols.success ?? "✓";
      indicatorColor = theme?.colors.success ?? "green";
      break;
    case "failed":
      indicator = theme?.symbols.error ?? "✗";
      indicatorColor = theme?.colors.error ?? "red";
      break;
    case "in_progress":
      indicator = SYMBOLS.spinnerDots[spinnerFrame % SYMBOLS.spinnerDots.length] ?? "⠋";
      indicatorColor = theme?.colors.primary ?? "cyan";
      break;
    case "skipped":
      indicator = "-";
      indicatorColor = theme?.colors.text.muted ?? "gray";
      break;
    default: // pending
      indicator = "○";
      indicatorColor = theme?.colors.text.muted ?? "gray";
  }

  // Add indicator
  cells.push({ char: " " });
  cells.push({ char: " " });
  cells.push({ char: indicator, fg: colorToString(indicatorColor) });
  cells.push({ char: " " });

  // Add label
  const labelColor = task.status === "skipped" || task.status === "pending"
    ? theme?.colors.text.muted ?? "gray"
    : theme?.colors.text.primary ?? "white";

  for (const char of task.label) {
    cells.push({ char, fg: colorToString(labelColor), dim: task.status === "pending" });
  }

  // Add duration if completed
  if (task.duration && task.status === "completed") {
    for (const char of `  ${task.duration}`) {
      cells.push({ char, fg: colorToString(theme?.colors.text.muted), dim: true });
    }
  }

  // Add error if failed
  if (task.error && task.status === "failed") {
    for (const char of ` - ${task.error}`) {
      cells.push({ char, fg: colorToString(theme?.colors.error ?? "red") });
    }
  }

  return cells;
}

// ============================================================================
// Helpers
// ============================================================================

function colorToString(color?: Color): string | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "number") return undefined;
  if (typeof color === "string" && color.startsWith("#")) return undefined;
  return color as string;
}
