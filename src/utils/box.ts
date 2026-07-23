/**
 * Box Drawing
 *
 * Creates polished bordered boxes with various styles.
 * Inspired by Lip Gloss (charmbracelet).
 */

// deno-lint-ignore no-control-regex -- intentional: matches terminal control sequences
const ANSI_REGEX = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;
const RESET = `\x1b[0m`;
const MAX_LAYOUT_SIZE = 10_000;
const TAB_WIDTH = 8;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ZERO_WIDTH_CHARACTER = /[\p{Mark}\p{Cf}]/u;
const EMOJI_WIDTH_CHARACTER = /[\p{Emoji_Presentation}\p{Regional_Indicator}\uFE0F\u20E3]/u;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

function visibleLength(text: string): number {
  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(stripAnsi(text))) {
    if (segment === "\t") {
      width += TAB_WIDTH - (width % TAB_WIDTH);
      continue;
    }
    if (EMOJI_WIDTH_CHARACTER.test(segment)) {
      width += 2;
      continue;
    }

    let baseCodePoint: number | undefined;
    for (const character of segment) {
      const codePoint = character.codePointAt(0)!;
      if (
        codePoint === 0 || codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        ZERO_WIDTH_CHARACTER.test(character)
      ) continue;
      baseCodePoint = codePoint;
      break;
    }
    if (baseCodePoint !== undefined) width += isFullWidthCodePoint(baseCodePoint) ? 2 : 1;
  }
  return width;
}

/** Unicode code points that occupy two columns in conventional terminals. */
function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 || codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
      (codePoint >= 0x3040 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1b000 && codePoint <= 0x1b2ff) ||
      (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd));
}

function repeat(char: string, count: number): string {
  return count <= 0 ? "" : char.repeat(count);
}

function validateLayoutSize(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_LAYOUT_SIZE) {
    throw new RangeError(`${name} must be an integer between 0 and ${MAX_LAYOUT_SIZE}.`);
  }
}

function validateChoice(value: string, choices: readonly string[], name: string): void {
  if (!choices.includes(value)) {
    throw new RangeError(`${name} must be one of: ${choices.join(", ")}.`);
  }
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
  validateChoice(align, ["left", "center", "right"], "align");
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

  validateLayoutSize(padding, "padding");
  validateLayoutSize(paddingX, "paddingX");
  validateLayoutSize(paddingY, "paddingY");
  if (width !== undefined) validateLayoutSize(width, "width");
  validateChoice(style, Object.keys(BORDER_STYLES), "style");
  validateChoice(titleAlign, ["left", "center", "right"], "titleAlign");

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
  validateLayoutSize(gap, "gap");
  validateChoice(align, ["top", "center", "bottom"], "align");
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
  validateLayoutSize(gap, "gap");
  validateChoice(align, ["left", "center", "right"], "align");
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
  validateLayoutSize(width, "width");
  validateChoice(style, Object.keys(BORDER_STYLES), "style");
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
  validateLayoutSize(width, "width");
  validateChoice(style, Object.keys(BORDER_STYLES), "style");
  const border = BORDER_STYLES[style];
  const textLen = visibleLength(text) + 2;
  const remaining = width - textLen;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;

  return repeat(border.horizontal, left) + ` ${text} ` + repeat(border.horizontal, right);
}
