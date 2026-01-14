// deno-lint-ignore-file no-explicit-any
/**
 * Box Component
 *
 * Container component with optional border, padding, and background.
 */

import type { Cell } from "../../core/renderer.ts";
import type { Color, Theme } from "../../themes/types.ts";
import { BOX_CHARS } from "../../core/ansi.ts";

// ============================================================================
// Types
// ============================================================================

export type BorderStyle = "none" | "single" | "double" | "rounded";

export interface BoxStyle {
  /** Border style */
  border?: BorderStyle;
  /** Border color */
  borderColor?: Color;
  /** Background color */
  bg?: Color;
  /** Padding inside the box */
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** Title for the box (displayed in top border) */
  title?: string;
  /** Title alignment */
  titleAlign?: "left" | "center" | "right";
  /** Title color */
  titleColor?: Color;
}

export interface BoxProps {
  /** Box width (including border) */
  width: number;
  /** Box height (including border) */
  height: number;
  /** X position */
  x?: number;
  /** Y position */
  y?: number;
  /** Box style */
  style?: BoxStyle;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Draw a box to a buffer
 */
export function drawBox(
  buffer: Cell[][],
  props: BoxProps,
  theme?: Theme,
): void {
  const { width, height, x = 0, y = 0, style = {} } = props;
  const {
    border = "rounded",
    borderColor,
    bg,
    title,
    titleAlign = "left",
    titleColor,
  } = style;

  if (width < 2 || height < 2) return;

  const borderColorStr = colorToString(borderColor ?? theme?.colors.border.inactive);
  const bgColorStr = colorToString(bg);
  const titleColorStr = colorToString(titleColor ?? theme?.colors.primary);

  // No border - just fill background
  if (border === "none") {
    if (bgColorStr) {
      fillRect(buffer, x, y, width, height, " ", bgColorStr);
    }
    return;
  }

  const chars = BOX_CHARS[border];

  // Draw corners
  setCell(buffer, x, y, chars.topLeft, borderColorStr, bgColorStr);
  setCell(buffer, x + width - 1, y, chars.topRight, borderColorStr, bgColorStr);
  setCell(buffer, x, y + height - 1, chars.bottomLeft, borderColorStr, bgColorStr);
  setCell(buffer, x + width - 1, y + height - 1, chars.bottomRight, borderColorStr, bgColorStr);

  // Draw horizontal borders
  for (let i = 1; i < width - 1; i++) {
    setCell(buffer, x + i, y, chars.horizontal, borderColorStr, bgColorStr);
    setCell(buffer, x + i, y + height - 1, chars.horizontal, borderColorStr, bgColorStr);
  }

  // Draw vertical borders
  for (let i = 1; i < height - 1; i++) {
    setCell(buffer, x, y + i, chars.vertical, borderColorStr, bgColorStr);
    setCell(buffer, x + width - 1, y + i, chars.vertical, borderColorStr, bgColorStr);
  }

  // Fill interior with background
  if (bgColorStr) {
    for (let row = y + 1; row < y + height - 1; row++) {
      for (let col = x + 1; col < x + width - 1; col++) {
        setCell(buffer, col, row, " ", undefined, bgColorStr);
      }
    }
  }

  // Draw title if provided
  if (title && width > 4) {
    const maxTitleWidth = width - 4; // Leave space for border and padding
    const displayTitle = title.length > maxTitleWidth
      ? title.slice(0, maxTitleWidth - 1) + "…"
      : title;

    let titleX: number;
    switch (titleAlign) {
      case "center":
        titleX = x + Math.floor((width - displayTitle.length) / 2);
        break;
      case "right":
        titleX = x + width - displayTitle.length - 2;
        break;
      default:
        titleX = x + 2;
    }

    // Write title characters
    for (let i = 0; i < displayTitle.length; i++) {
      setCell(buffer, titleX + i, y, displayTitle[i], titleColorStr, bgColorStr, true);
    }
  }
}

/**
 * Draw a horizontal divider line
 */
export function drawHDivider(
  buffer: Cell[][],
  x: number,
  y: number,
  width: number,
  style: BorderStyle = "single",
  color?: Color,
): void {
  if (style === "none") return;

  const chars = BOX_CHARS[style];
  const colorStr = colorToString(color);

  for (let i = 0; i < width; i++) {
    const char = i === 0 ? chars.teeRight : i === width - 1 ? chars.teeLeft : chars.horizontal;
    setCell(buffer, x + i, y, char, colorStr);
  }
}

/**
 * Draw a vertical divider line
 */
export function drawVDivider(
  buffer: Cell[][],
  x: number,
  y: number,
  height: number,
  style: BorderStyle = "single",
  color?: Color,
): void {
  if (style === "none") return;

  const chars = BOX_CHARS[style];
  const colorStr = colorToString(color);

  for (let i = 0; i < height; i++) {
    const char = i === 0 ? chars.teeBottom : i === height - 1 ? chars.teeTop : chars.vertical;
    setCell(buffer, x, y + i, char, colorStr);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function setCell(
  buffer: Cell[][],
  x: number,
  y: number,
  char: string,
  fg?: string,
  bg?: string,
  bold?: boolean,
): void {
  if (y < 0 || y >= buffer.length) return;
  if (x < 0 || x >= buffer[y].length) return;

  buffer[y][x] = { char, fg, bg, bold };
}

function fillRect(
  buffer: Cell[][],
  x: number,
  y: number,
  width: number,
  height: number,
  char: string,
  bg?: string,
): void {
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      setCell(buffer, col, row, char, undefined, bg);
    }
  }
}

function colorToString(color?: Color): string | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "number") return undefined;
  if (typeof color === "string" && color.startsWith("#")) return undefined;
  return color as string;
}

// ============================================================================
// Box Builder (Fluent API)
// ============================================================================

export function createBox(width: number, height: number): BoxProps {
  return { width, height };
}

export function withBorder(props: BoxProps, style: BorderStyle = "rounded"): BoxProps {
  return {
    ...props,
    style: { ...props.style, border: style },
  };
}

export function withTitle(
  props: BoxProps,
  title: string,
  align?: "left" | "center" | "right",
): BoxProps {
  return {
    ...props,
    style: { ...props.style, title, titleAlign: align },
  };
}

export function withBackground(props: BoxProps, color: Color): BoxProps {
  return {
    ...props,
    style: { ...props.style, bg: color },
  };
}

export function atPosition(props: BoxProps, x: number, y: number): BoxProps {
  return { ...props, x, y };
}
