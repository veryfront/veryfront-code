// deno-lint-ignore-file no-explicit-any
/**
 * Text Component
 *
 * Renders styled text with color, bold, dim, and other formatting options.
 */

import type { Cell } from "../../core/renderer.ts";
import type { Color, Theme } from "../../themes/types.ts";
import { stringWidth } from "../../utils/unicode.ts";

// ============================================================================
// Types
// ============================================================================

export interface TextStyle {
  /** Text color */
  color?: Color;
  /** Background color */
  bg?: Color;
  /** Bold text */
  bold?: boolean;
  /** Dim text */
  dim?: boolean;
  /** Italic text */
  italic?: boolean;
  /** Underlined text */
  underline?: boolean;
  /** Inverted colors */
  inverse?: boolean;
}

export interface TextProps {
  /** Text content */
  content: string;
  /** Text style */
  style?: TextStyle;
  /** Maximum width (truncates with ellipsis) */
  maxWidth?: number;
  /** Alignment within maxWidth */
  align?: "left" | "center" | "right";
  /** Padding character for alignment */
  padChar?: string;
}

export interface TextRenderResult {
  /** Array of cells representing the rendered text */
  cells: Cell[];
  /** Visible width of the rendered text */
  width: number;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render text to an array of cells
 */
export function renderText(props: TextProps, _theme?: Theme): TextRenderResult {
  const { content, style = {}, maxWidth, align = "left", padChar = " " } = props;

  let text = content;
  let width = stringWidth(text);

  // Truncate if needed
  if (maxWidth !== undefined && width > maxWidth) {
    text = truncateText(text, maxWidth);
    width = maxWidth;
  }

  // Create cells for each character
  const cells: Cell[] = [];
  const colorStr = colorToString(style.color);
  const bgStr = colorToString(style.bg);

  for (const char of text) {
    cells.push({
      char,
      fg: colorStr,
      bg: bgStr,
      bold: style.bold,
      dim: style.dim,
      italic: style.italic,
      underline: style.underline,
      inverse: style.inverse,
    });
  }

  // Handle alignment and padding
  if (maxWidth !== undefined && width < maxWidth) {
    const padding = maxWidth - width;
    const padCell: Cell = {
      char: padChar,
      fg: colorStr,
      bg: bgStr,
    };

    switch (align) {
      case "right": {
        const leftPad = Array(padding).fill(padCell);
        return { cells: [...leftPad, ...cells], width: maxWidth };
      }
      case "center": {
        const leftPadCount = Math.floor(padding / 2);
        const rightPadCount = padding - leftPadCount;
        const leftPad = Array(leftPadCount).fill(padCell);
        const rightPad = Array(rightPadCount).fill(padCell);
        return { cells: [...leftPad, ...cells, ...rightPad], width: maxWidth };
      }
      default: {
        const rightPad = Array(padding).fill(padCell);
        return { cells: [...cells, ...rightPad], width: maxWidth };
      }
    }
  }

  return { cells, width };
}

/**
 * Write text to a buffer at a specific position
 */
export function writeText(
  buffer: Cell[][],
  x: number,
  y: number,
  props: TextProps,
  theme?: Theme,
): number {
  const { cells, width } = renderText(props, theme);

  if (y < 0 || y >= buffer.length) return 0;

  let col = x;
  for (const cell of cells) {
    if (col >= 0 && col < buffer[y].length) {
      buffer[y][col] = cell;
    }
    col++;
  }

  return width;
}

// ============================================================================
// Helpers
// ============================================================================

function truncateText(text: string, maxWidth: number, suffix = "…"): string {
  const suffixWidth = stringWidth(suffix);
  if (maxWidth <= suffixWidth) return suffix.slice(0, maxWidth);

  const targetWidth = maxWidth - suffixWidth;
  let width = 0;
  let result = "";

  for (const char of text) {
    const charWidth = stringWidth(char);
    if (width + charWidth > targetWidth) {
      return result + suffix;
    }
    width += charWidth;
    result += char;
  }

  return text;
}

function colorToString(color?: Color): string | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "number") {
    // 256-color code - would need special handling
    return undefined;
  }
  if (typeof color === "string" && color.startsWith("#")) {
    // Hex color - would need special handling
    return undefined;
  }
  return color as string;
}

// ============================================================================
// Styled Text Builders
// ============================================================================

/**
 * Create styled text props quickly
 */
export const text = {
  plain: (content: string): TextProps => ({ content }),

  bold: (content: string, color?: Color): TextProps => ({
    content,
    style: { bold: true, color },
  }),

  dim: (content: string): TextProps => ({
    content,
    style: { dim: true },
  }),

  success: (content: string, theme?: Theme): TextProps => ({
    content,
    style: { color: theme?.colors.success ?? "green" },
  }),

  error: (content: string, theme?: Theme): TextProps => ({
    content,
    style: { color: theme?.colors.error ?? "red" },
  }),

  warning: (content: string, theme?: Theme): TextProps => ({
    content,
    style: { color: theme?.colors.warning ?? "yellow" },
  }),

  info: (content: string, theme?: Theme): TextProps => ({
    content,
    style: { color: theme?.colors.info ?? "blue" },
  }),

  primary: (content: string, theme?: Theme): TextProps => ({
    content,
    style: { color: theme?.colors.primary ?? "cyan" },
  }),

  muted: (content: string): TextProps => ({
    content,
    style: { dim: true, color: "gray" },
  }),

  link: (content: string): TextProps => ({
    content,
    style: { underline: true, color: "blue" },
  }),

  highlight: (content: string, theme?: Theme): TextProps => ({
    content,
    style: {
      inverse: true,
      color: theme?.colors.selection.fg,
      bg: theme?.colors.selection.bg,
    },
  }),
};
