/**
 * Button Component
 *
 * Interactive clickable button with hover and selected states.
 * Returns hit area for mouse interaction.
 *
 * @module cli/tui/components/interactive/button
 */

import type { Cell } from "../../core/renderer.ts";
import type { Theme } from "../../themes/types.ts";
import type { HitArea } from "../../core/mouse.ts";
import { BOX_CHARS } from "../../core/ansi.ts";

// ============================================================================
// Types
// ============================================================================

export interface ButtonStyle {
  /** Border style */
  border?: "none" | "single" | "rounded";
  /** Minimum width (auto-sized to label if not set) */
  minWidth?: number;
  /** Padding inside button */
  padding?: number;
}

export interface ButtonProps {
  /** Button label text */
  label: string;
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Whether the button is selected/focused */
  selected?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is hovered (mouse over) */
  hovered?: boolean;
  /** Button style */
  style?: ButtonStyle;
  /** Unique ID for hit area */
  id?: string;
  /** Click handler */
  onClick?: () => void;
}

export interface ButtonResult {
  /** Hit area for mouse interaction */
  hitArea: HitArea;
  /** Actual width of rendered button */
  width: number;
  /** Actual height of rendered button */
  height: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function setCell(
  buffer: Cell[][],
  x: number,
  y: number,
  char: string,
  fg?: string,
  bg?: string,
): void {
  if (y >= 0 && y < buffer.length && x >= 0 && x < (buffer[y]?.length ?? 0)) {
    buffer[y][x] = { char, fg, bg };
  }
}

function colorToString(color: string | undefined): string | undefined {
  return color;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render a button to a buffer and return hit area
 */
export function renderButton(
  buffer: Cell[][],
  props: ButtonProps,
  theme: Theme,
): ButtonResult {
  const {
    label,
    x,
    y,
    selected = false,
    disabled = false,
    hovered = false,
    style = {},
    id = `button-${x}-${y}`,
    onClick,
  } = props;

  const { border = "rounded", minWidth = 0, padding = 1 } = style;

  // Calculate dimensions
  const contentWidth = label.length + padding * 2;
  const width = Math.max(contentWidth + 2, minWidth); // +2 for borders
  const height = 3; // Top border, content, bottom border

  // Determine colors based on state
  let borderColor: string;
  let textColor: string;
  let bgColor: string | undefined;

  if (disabled) {
    borderColor = theme.colors.text.muted;
    textColor = theme.colors.text.muted;
    bgColor = undefined;
  } else if (selected) {
    borderColor = theme.colors.primary;
    textColor = theme.colors.primary;
    bgColor = theme.colors.background.selection;
  } else if (hovered) {
    borderColor = theme.colors.info;
    textColor = theme.colors.text.primary;
    bgColor = theme.colors.background.secondary;
  } else {
    borderColor = theme.colors.border.inactive;
    textColor = theme.colors.text.primary;
    bgColor = undefined;
  }

  // Get border characters
  const chars = border === "none" ? null : BOX_CHARS[border];

  if (chars) {
    // Draw top border
    setCell(buffer, x, y, chars.topLeft, borderColor, bgColor);
    for (let i = 1; i < width - 1; i++) {
      setCell(buffer, x + i, y, chars.horizontal, borderColor, bgColor);
    }
    setCell(buffer, x + width - 1, y, chars.topRight, borderColor, bgColor);

    // Draw middle row with label
    setCell(buffer, x, y + 1, chars.vertical, borderColor, bgColor);

    // Fill and center label
    const labelStart = x + 1 + Math.floor((width - 2 - label.length) / 2);
    for (let i = 1; i < width - 1; i++) {
      const charX = x + i;
      const labelOffset = charX - labelStart;
      if (labelOffset >= 0 && labelOffset < label.length) {
        setCell(buffer, charX, y + 1, label[labelOffset], textColor, bgColor);
      } else {
        setCell(buffer, charX, y + 1, " ", textColor, bgColor);
      }
    }

    setCell(buffer, x + width - 1, y + 1, chars.vertical, borderColor, bgColor);

    // Draw bottom border
    setCell(buffer, x, y + 2, chars.bottomLeft, borderColor, bgColor);
    for (let i = 1; i < width - 1; i++) {
      setCell(buffer, x + i, y + 2, chars.horizontal, borderColor, bgColor);
    }
    setCell(buffer, x + width - 1, y + 2, chars.bottomRight, borderColor, bgColor);
  } else {
    // No border - just render label
    for (let i = 0; i < label.length; i++) {
      setCell(buffer, x + padding + i, y + 1, label[i], textColor, bgColor);
    }
  }

  // Return hit area for mouse interaction
  return {
    hitArea: {
      x,
      y,
      width,
      height,
      id,
      onClick,
    },
    width,
    height,
  };
}

/**
 * Render a row of buttons horizontally
 */
export function renderButtonRow(
  buffer: Cell[][],
  buttons: Omit<ButtonProps, "x" | "y">[],
  startX: number,
  startY: number,
  gap: number,
  theme: Theme,
): ButtonResult[] {
  const results: ButtonResult[] = [];
  let currentX = startX;

  for (const button of buttons) {
    const result = renderButton(buffer, { ...button, x: currentX, y: startY }, theme);
    results.push(result);
    currentX += result.width + gap;
  }

  return results;
}
