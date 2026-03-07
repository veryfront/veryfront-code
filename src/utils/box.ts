/**
 * Box Drawing
 *
 * Creates polished bordered boxes with various styles.
 * Inspired by Lip Gloss (charmbracelet).
 */

// deno-lint-ignore no-control-regex -- intentional: matches ANSI escape sequences for terminal color stripping
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const RESET = `\x1b[0m`;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function repeat(char: string, count: number): string {
  return count <= 0 ? "" : char.repeat(count);
}

function lines(text: string): string[] {
  return text.split("\n");
}

function maxLineWidth(textLines: string[]): number {
  return Math.max(0, ...textLines.map(visibleLength));
}

export function pad(
  text: string,
  width: number,
  align: "left" | "center" | "right" = "left",
): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;

  const padding = width - visible;

  if (align === "right") return " ".repeat(padding) + text;

  if (align === "center") {
    const left = Math.floor(padding / 2);
    return " ".repeat(left) + text + " ".repeat(padding - left);
  }

  return text + " ".repeat(padding);
}

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

type BorderStyle = keyof typeof BORDER_STYLES;

interface BoxOptions {
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
    width,
  } = options;

  const border = BORDER_STYLES[style];
  const contentLines = lines(content);
  const contentWidth = maxLineWidth(contentLines);

  const innerWidth = Math.max(
    contentWidth + paddingX * 2,
    title ? visibleLength(title) + 4 : 0, // Ensure title fits
  );

  const boxWidth = width ? Math.max(width, innerWidth + 2) : innerWidth + 2;
  const actualInnerWidth = boxWidth - 2;

  const colorize = (
    color: string,
    text: string,
  ): string => (color ? `${color}${text}${RESET}` : text);
  const bc = (text: string): string => colorize(borderColor, text);
  const tc = (text: string): string => colorize(titleColor, text);

  const result: string[] = [];

  if (title) {
    const titleText = ` ${tc(title)} `;
    const titleLen = visibleLength(titleText);
    const remainingWidth = actualInnerWidth - titleLen;

    let left = 0;
    let right = 0;

    if (titleAlign === "center") {
      left = Math.floor(remainingWidth / 2);
      right = remainingWidth - left;
    } else if (titleAlign === "right") {
      left = remainingWidth;
      right = 0;
    } else {
      right = remainingWidth;
    }

    result.push(
      bc(border.topLeft) +
        bc(repeat(border.horizontal, left)) +
        titleText +
        bc(repeat(border.horizontal, right)) +
        bc(border.topRight),
    );
  } else {
    result.push(
      bc(border.topLeft) + bc(repeat(border.horizontal, actualInnerWidth)) + bc(border.topRight),
    );
  }

  const emptyLine = bc(border.vertical) + repeat(" ", actualInnerWidth) + bc(border.vertical);

  for (let i = 0; i < paddingY; i++) result.push(emptyLine);

  for (const line of contentLines) {
    const paddedLine = repeat(" ", paddingX) +
      pad(line, actualInnerWidth - paddingX * 2, "left") +
      repeat(" ", paddingX);

    result.push(bc(border.vertical) + paddedLine + bc(border.vertical));
  }

  for (let i = 0; i < paddingY; i++) result.push(emptyLine);

  result.push(
    bc(border.bottomLeft) + bc(repeat(border.horizontal, actualInnerWidth)) +
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
  if (items.length === 1) return items[0] ?? "";

  const itemLines = items.map(lines);
  const maxHeight = Math.max(...itemLines.map((l) => l.length));
  const itemWidths = itemLines.map(maxLineWidth);

  const paddedItems = itemLines.map((itemLns, idx) => {
    const width = itemWidths[idx] ?? 0;
    const padCount = maxHeight - itemLns.length;
    if (padCount <= 0) return itemLns;

    const blank = repeat(" ", width);

    if (align === "bottom") return [...Array(padCount).fill(blank), ...itemLns];

    if (align === "center") {
      const top = Math.floor(padCount / 2);
      const bottom = padCount - top;
      return [...Array(top).fill(blank), ...itemLns, ...Array(bottom).fill(blank)];
    }

    return [...itemLns, ...Array(padCount).fill(blank)];
  });

  const gapStr = repeat(" ", gap);
  const result: string[] = [];

  for (let i = 0; i < maxHeight; i++) {
    const lineParts = paddedItems.map((item, idx) =>
      pad(item[i] ?? "", itemWidths[idx] ?? 0, "left")
    );
    result.push(lineParts.join(gapStr));
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
  if (items.length === 1) return items[0] ?? "";

  const allLines = items.flatMap((item, idx) => {
    const itemLns = lines(item);
    if (idx >= items.length - 1 || gap <= 0) return itemLns;
    return [...itemLns, ...Array(gap).fill("")];
  });

  const maxWidth = maxLineWidth(allLines);
  return allLines.map((line) => pad(line, maxWidth, align)).join("\n");
}

/**
 * Create a horizontal divider
 */
export function divider(width: number, style: BorderStyle = "rounded"): string {
  return repeat(BORDER_STYLES[style].horizontal, width);
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
  const textLen = visibleLength(text) + 2;
  const remaining = width - textLen;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;

  return repeat(border.horizontal, left) + ` ${text} ` + repeat(border.horizontal, right);
}
