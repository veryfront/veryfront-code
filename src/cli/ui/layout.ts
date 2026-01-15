/**
 * Layout utilities for CLI
 *
 * Provides terminal-aware layout primitives for responsive CLI design.
 */

/**
 * Get terminal width, with fallback for non-TTY environments
 */
export function getTerminalWidth(): number {
  try {
    const { columns } = Deno.consoleSize();
    return columns;
  } catch {
    return 80; // Default fallback
  }
}

/**
 * Get terminal height, with fallback for non-TTY environments
 */
export function getTerminalHeight(): number {
  try {
    const { rows } = Deno.consoleSize();
    return rows;
  } catch {
    return 24; // Default fallback
  }
}

/**
 * Check if output is a TTY (interactive terminal)
 */
export function isTTY(): boolean {
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

/**
 * Get visible length of a string (excluding ANSI escape codes)
 */
export function visibleLength(text: string): number {
  // Remove ANSI escape sequences
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Truncate text to fit within maxWidth, adding ellipsis if needed
 */
export function truncate(text: string, maxWidth: number, ellipsis = "…"): string {
  const visible = visibleLength(text);
  if (visible <= maxWidth) return text;

  // Need to truncate - find the right cut point
  let visibleCount = 0;
  let cutIndex = 0;

  // deno-lint-ignore no-control-regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Count visible chars before this ANSI sequence
    const visiblePart = text.slice(lastIndex, match.index);
    for (let i = 0; i < visiblePart.length; i++) {
      if (visibleCount >= maxWidth - ellipsis.length) break;
      cutIndex = lastIndex + i + 1;
      visibleCount++;
    }
    if (visibleCount >= maxWidth - ellipsis.length) break;
    cutIndex = match.index + match[0].length;
    lastIndex = ansiRegex.lastIndex;
  }

  // Handle remaining text after last ANSI sequence
  if (visibleCount < maxWidth - ellipsis.length) {
    const remaining = text.slice(lastIndex);
    for (let i = 0; i < remaining.length; i++) {
      if (visibleCount >= maxWidth - ellipsis.length) break;
      cutIndex = lastIndex + i + 1;
      visibleCount++;
    }
  }

  return text.slice(0, cutIndex) + ellipsis + "\x1b[0m";
}

/**
 * Pad text to a specific width
 */
export function pad(
  text: string,
  width: number,
  align: "left" | "center" | "right" = "left",
): string {
  const visible = visibleLength(text);
  if (visible >= width) return text;

  const padding = width - visible;

  switch (align) {
    case "right":
      return " ".repeat(padding) + text;
    case "center": {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return " ".repeat(left) + text + " ".repeat(right);
    }
    case "left":
    default:
      return text + " ".repeat(padding);
  }
}

/**
 * Wrap text to fit within maxWidth
 * Returns array of lines
 */
export function wrap(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const wordLength = visibleLength(word);
    const lineLength = visibleLength(currentLine);

    if (lineLength === 0) {
      currentLine = word;
    } else if (lineLength + 1 + wordLength <= maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Repeat a character or string to fill width
 */
export function repeat(char: string, count: number): string {
  if (count <= 0) return "";
  return char.repeat(count);
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Split text into lines
 */
export function lines(text: string): string[] {
  return text.split("\n");
}

/**
 * Get the maximum visible width of lines
 */
export function maxLineWidth(textLines: string[]): number {
  return Math.max(0, ...textLines.map(visibleLength));
}
