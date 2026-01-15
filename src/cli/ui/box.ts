/**
 * Box Drawing for CLI
 *
 * Creates polished bordered boxes with various styles.
 * Inspired by Lip Gloss (charmbracelet).
 */

import { lines, maxLineWidth, pad, repeat, visibleLength } from "./layout.ts";

/**
 * Box border styles using Unicode box-drawing characters
 */
export const BORDER_STYLES = {
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  square: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  },
  heavy: {
    topLeft: "┏",
    topRight: "┓",
    bottomLeft: "┗",
    bottomRight: "┛",
    horizontal: "━",
    vertical: "┃",
  },
  none: {
    topLeft: " ",
    topRight: " ",
    bottomLeft: " ",
    bottomRight: " ",
    horizontal: " ",
    vertical: " ",
  },
} as const;

export type BorderStyle = keyof typeof BORDER_STYLES;

export interface BoxOptions {
  /** Border style (default: "rounded") */
  style?: BorderStyle;
  /** Box width (default: auto-fit content) */
  width?: number;
  /** Padding inside the box (default: 1) */
  padding?: number;
  /** Horizontal padding (overrides padding) */
  paddingX?: number;
  /** Vertical padding (overrides padding) */
  paddingY?: number;
  /** Title in top border */
  title?: string;
  /** Title alignment (default: "left") */
  titleAlign?: "left" | "center" | "right";
  /** Border color (ANSI escape code) */
  borderColor?: string;
  /** Title color (ANSI escape code) */
  titleColor?: string;
}

const RESET = "\x1b[0m";

/**
 * Create a bordered box around content
 */
export function box(content: string, options: BoxOptions = {}): string {
  const {
    style = "rounded",
    padding = 1,
    paddingX = padding,
    paddingY = Math.max(0, padding - 1), // Vertical padding is usually less
    title,
    titleAlign = "left",
    borderColor = "",
    titleColor = "",
  } = options;

  const border = BORDER_STYLES[style];
  const contentLines = lines(content);

  // Calculate content width
  const contentWidth = maxLineWidth(contentLines);

  // Calculate box inner width (content + horizontal padding)
  const innerWidth = Math.max(
    contentWidth + paddingX * 2,
    title ? visibleLength(title) + 4 : 0, // Ensure title fits
  );

  // Use specified width or auto-fit
  const boxWidth = options.width ? Math.max(options.width, innerWidth + 2) : innerWidth + 2;
  const actualInnerWidth = boxWidth - 2; // Account for borders

  // Color helpers
  const bc = (text: string) => borderColor ? `${borderColor}${text}${RESET}` : text;
  const tc = (text: string) => titleColor ? `${titleColor}${text}${RESET}` : text;

  const result: string[] = [];

  // Top border with optional title
  if (title) {
    const titleText = ` ${tc(title)} `;
    const titleLen = visibleLength(titleText);
    const remainingWidth = actualInnerWidth - titleLen;

    let topLine: string;
    switch (titleAlign) {
      case "center": {
        const left = Math.floor(remainingWidth / 2);
        const right = remainingWidth - left;
        topLine = bc(border.topLeft) +
          bc(repeat(border.horizontal, left)) +
          titleText +
          bc(repeat(border.horizontal, right)) +
          bc(border.topRight);
        break;
      }
      case "right": {
        topLine = bc(border.topLeft) +
          bc(repeat(border.horizontal, remainingWidth)) +
          titleText +
          bc(border.topRight);
        break;
      }
      case "left":
      default: {
        topLine = bc(border.topLeft) +
          titleText +
          bc(repeat(border.horizontal, remainingWidth)) +
          bc(border.topRight);
        break;
      }
    }
    result.push(topLine);
  } else {
    result.push(
      bc(border.topLeft) +
        bc(repeat(border.horizontal, actualInnerWidth)) +
        bc(border.topRight),
    );
  }

  // Vertical padding (top)
  for (let i = 0; i < paddingY; i++) {
    result.push(
      bc(border.vertical) +
        repeat(" ", actualInnerWidth) +
        bc(border.vertical),
    );
  }

  // Content lines
  for (const line of contentLines) {
    const paddedLine = repeat(" ", paddingX) +
      pad(line, actualInnerWidth - paddingX * 2, "left") +
      repeat(" ", paddingX);
    result.push(
      bc(border.vertical) +
        paddedLine +
        bc(border.vertical),
    );
  }

  // Vertical padding (bottom)
  for (let i = 0; i < paddingY; i++) {
    result.push(
      bc(border.vertical) +
        repeat(" ", actualInnerWidth) +
        bc(border.vertical),
    );
  }

  // Bottom border
  result.push(
    bc(border.bottomLeft) +
      bc(repeat(border.horizontal, actualInnerWidth)) +
      bc(border.bottomRight),
  );

  return result.join("\n");
}

/**
 * Join multiple strings horizontally with alignment
 */
export function joinHorizontal(
  align: "top" | "center" | "bottom",
  gap: number,
  ...items: string[]
): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;

  // Split each item into lines
  const itemLines = items.map(lines);
  const maxHeight = Math.max(...itemLines.map((l) => l.length));
  const itemWidths = itemLines.map(maxLineWidth);

  // Pad items to same height
  const paddedItems = itemLines.map((itemLns, idx) => {
    const width = itemWidths[idx] ?? 0;
    const padCount = maxHeight - itemLns.length;

    switch (align) {
      case "bottom":
        return [...Array(padCount).fill(repeat(" ", width)), ...itemLns];
      case "center": {
        const top = Math.floor(padCount / 2);
        const bottom = padCount - top;
        return [
          ...Array(top).fill(repeat(" ", width)),
          ...itemLns,
          ...Array(bottom).fill(repeat(" ", width)),
        ];
      }
      case "top":
      default:
        return [...itemLns, ...Array(padCount).fill(repeat(" ", width))];
    }
  });

  // Join lines
  const result: string[] = [];
  for (let i = 0; i < maxHeight; i++) {
    const lineParts = paddedItems.map((item, idx) => {
      const line = item[i] || "";
      return pad(line, itemWidths[idx] ?? 0, "left");
    });
    result.push(lineParts.join(repeat(" ", gap)));
  }

  return result.join("\n");
}

/**
 * Join multiple strings vertically with alignment
 */
export function joinVertical(
  align: "left" | "center" | "right",
  gap: number,
  ...items: string[]
): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;

  const allLines = items.flatMap((item, idx) => {
    const itemLns = lines(item);
    // Add gap lines between items (not after last)
    if (idx < items.length - 1 && gap > 0) {
      return [...itemLns, ...Array(gap).fill("")];
    }
    return itemLns;
  });

  const maxWidth = maxLineWidth(allLines);

  return allLines.map((line) => pad(line, maxWidth, align)).join("\n");
}

/**
 * Create a horizontal divider
 */
export function divider(width: number, style: BorderStyle = "rounded"): string {
  const border = BORDER_STYLES[style];
  return repeat(border.horizontal, width);
}

/**
 * Create a divider with centered text
 */
export function dividerWithText(
  text: string,
  width: number,
  style: BorderStyle = "rounded",
): string {
  const border = BORDER_STYLES[style];
  const textLen = visibleLength(text) + 2; // Add spaces around text
  const remaining = width - textLen;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;

  return repeat(border.horizontal, left) +
    ` ${text} ` +
    repeat(border.horizontal, right);
}
