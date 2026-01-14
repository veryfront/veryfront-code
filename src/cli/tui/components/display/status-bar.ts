/**
 * Status Bar Component
 *
 * Renders a status bar at the bottom of the terminal with
 * customizable left, center, and right sections.
 */

import type { Cell } from "../../core/renderer.ts";
import type { Color, Theme } from "../../themes/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface StatusBarItem {
  /** Text content */
  text: string;
  /** Text color */
  color?: Color;
  /** Background color */
  bg?: Color;
  /** Icon/prefix */
  icon?: string;
  /** Icon color */
  iconColor?: Color;
  /** Whether this item is bold */
  bold?: boolean;
  /** Separator after this item */
  separator?: string;
}

export interface StatusBarProps {
  /** Items on the left side */
  left?: StatusBarItem[];
  /** Items in the center */
  center?: StatusBarItem[];
  /** Items on the right side */
  right?: StatusBarItem[];
  /** Total width */
  width: number;
  /** Background color for the entire bar */
  bg?: Color;
  /** Default separator between items */
  separator?: string;
}

export interface StatusBarRenderResult {
  /** Rendered cells (single line) */
  cells: Cell[];
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render a status bar to cells
 */
export function renderStatusBar(props: StatusBarProps, theme?: Theme): StatusBarRenderResult {
  const {
    left = [],
    center = [],
    right = [],
    width,
    bg,
    separator = " │ ",
  } = props;

  const bgColor = colorToString(bg ?? theme?.colors.background.secondary);

  // Render each section
  const leftCells = renderSection(left, separator, theme, bgColor);
  const centerCells = renderSection(center, separator, theme, bgColor);
  const rightCells = renderSection(right, separator, theme, bgColor);

  const leftWidth = leftCells.length;
  const centerWidth = centerCells.length;
  const rightWidth = rightCells.length;

  // Calculate total content width (for future overflow handling)
  const _totalContent = leftWidth + centerWidth + rightWidth;
  void _totalContent;

  // Create result array filled with background
  const cells: Cell[] = Array(width).fill(null).map(() => ({
    char: " ",
    bg: bgColor,
  }));

  // Place left section at start
  for (let i = 0; i < leftCells.length && i < width; i++) {
    const cell = leftCells[i];
    if (cell) {
      cells[i] = { char: cell.char, fg: cell.fg, bg: bgColor, bold: cell.bold, dim: cell.dim };
    }
  }

  // Place center section in middle
  if (centerCells.length > 0) {
    const centerStart = Math.floor((width - centerWidth) / 2);
    for (let i = 0; i < centerCells.length && centerStart + i < width; i++) {
      const cell = centerCells[i];
      if (centerStart + i >= 0 && cell) {
        cells[centerStart + i] = {
          char: cell.char,
          fg: cell.fg,
          bg: bgColor,
          bold: cell.bold,
          dim: cell.dim,
        };
      }
    }
  }

  // Place right section at end
  if (rightCells.length > 0) {
    const rightStart = width - rightWidth;
    for (let i = 0; i < rightCells.length; i++) {
      const cell = rightCells[i];
      if (rightStart + i >= 0 && rightStart + i < width && cell) {
        cells[rightStart + i] = {
          char: cell.char,
          fg: cell.fg,
          bg: bgColor,
          bold: cell.bold,
          dim: cell.dim,
        };
      }
    }
  }

  return { cells };
}

/**
 * Write status bar to buffer at specified row
 */
export function writeStatusBar(
  buffer: Cell[][],
  y: number,
  props: StatusBarProps,
  theme?: Theme,
): void {
  const { cells } = renderStatusBar({ ...props, width: buffer[0]?.length ?? props.width }, theme);

  if (y < 0 || y >= buffer.length) return;

  const row = buffer[y];
  if (!row) return;

  for (let x = 0; x < cells.length && x < row.length; x++) {
    const cell = cells[x];
    if (cell) {
      row[x] = cell;
    }
  }
}

// ============================================================================
// Section Rendering
// ============================================================================

function renderSection(
  items: StatusBarItem[],
  defaultSeparator: string,
  theme?: Theme,
  bgColor?: string,
): Cell[] {
  const cells: Cell[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    // Add icon if present
    if (item.icon) {
      const iconColor = colorToString(item.iconColor ?? item.color ?? theme?.colors.primary);
      for (const char of item.icon) {
        cells.push({ char, fg: iconColor, bg: bgColor });
      }
      cells.push({ char: " ", bg: bgColor });
    }

    // Add text
    const textColor = colorToString(item.color ?? theme?.colors.text.primary);
    for (const char of item.text) {
      cells.push({ char, fg: textColor, bg: bgColor, bold: item.bold });
    }

    // Add separator (except for last item)
    if (i < items.length - 1) {
      const sep = item.separator ?? defaultSeparator;
      const sepColor = colorToString(theme?.colors.text.muted ?? "gray");
      for (const char of sep) {
        cells.push({ char, fg: sepColor, bg: bgColor, dim: true });
      }
    }
  }

  return cells;
}

// ============================================================================
// Preset Status Bar Items
// ============================================================================

/**
 * Create a command/mode indicator item
 */
export function commandItem(command: string, theme?: Theme): StatusBarItem {
  return {
    icon: "⚡",
    iconColor: theme?.colors.accent ?? "yellow",
    text: command,
    color: theme?.colors.primary ?? "cyan",
    bold: true,
  };
}

/**
 * Create a project name item
 */
export function projectItem(name: string, theme?: Theme): StatusBarItem {
  return {
    icon: theme?.symbols.folder ?? "",
    iconColor: theme?.colors.info ?? "blue",
    text: name,
    color: theme?.colors.text.primary ?? "white",
  };
}

/**
 * Create a git branch item
 */
export function gitBranchItem(branch: string, theme?: Theme): StatusBarItem {
  return {
    icon: theme?.symbols.gitBranch ?? "",
    iconColor: theme?.colors.success ?? "green",
    text: branch,
    color: theme?.colors.text.secondary ?? "gray",
  };
}

/**
 * Create a status indicator item (with colored dot)
 */
export function statusItem(
  label: string,
  status: "success" | "warning" | "error" | "info",
  theme?: Theme,
): StatusBarItem {
  const colors: Record<string, Color> = {
    success: theme?.colors.success ?? "green",
    warning: theme?.colors.warning ?? "yellow",
    error: theme?.colors.error ?? "red",
    info: theme?.colors.info ?? "blue",
  };

  return {
    icon: "●",
    iconColor: colors[status],
    text: label,
    color: theme?.colors.text.secondary ?? "gray",
  };
}

/**
 * Create a time item
 */
export function timeItem(format?: "time" | "datetime"): StatusBarItem {
  const now = new Date();
  const text = format === "datetime" ? now.toLocaleString() : now.toLocaleTimeString();

  return {
    text,
    color: "gray",
  };
}

/**
 * Create a help hint item
 */
export function helpItem(text = "? help", theme?: Theme): StatusBarItem {
  return {
    text,
    color: theme?.colors.text.muted ?? "gray",
  };
}

/**
 * Create a keyboard shortcut hint
 */
export function shortcutItem(key: string, action: string, theme?: Theme): StatusBarItem {
  return {
    text: `${key} ${action}`,
    color: theme?.colors.text.muted ?? "gray",
  };
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
