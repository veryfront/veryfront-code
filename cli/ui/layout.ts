/*************************************************
 * Layout utilities for CLI
 *
 * Provides terminal-aware layout primitives for responsive CLI design.
 * Runtime-agnostic: works on Deno, Node.js, and Bun.
 *************************************************/

import { getTerminalSize, isStdoutTTY } from "#veryfront/platform/compat/process.ts";
import { ANSI_REGEX, RESET, stripAnsi } from "./ansi.ts";

/**
 * Get terminal width, with fallback for non-TTY environments
 */
export function getTerminalWidth(): number {
  return getTerminalSize().columns;
}

/**
 * Get terminal height, with fallback for non-TTY environments
 */
export function getTerminalHeight(): number {
  return getTerminalSize().rows;
}

/**
 * Check if output is a TTY (interactive terminal)
 */
export function isTTY(): boolean {
  return isStdoutTTY();
}

/**
 * Get visible length of a string (excluding ANSI escape codes)
 */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Truncate text to fit within maxWidth, adding ellipsis if needed
 */
export function truncate(text: string, maxWidth: number, ellipsis = "…"): string {
  if (visibleLength(text) <= maxWidth) return text;

  const maxVisible = maxWidth - ellipsis.length;
  let visibleCount = 0;
  let cutIndex = 0;

  // Create a new regex instance to avoid state issues with global flag
  const ansiRegex = new RegExp(ANSI_REGEX.source, "g");
  let lastIndex = 0;

  for (let match = ansiRegex.exec(text); match !== null; match = ansiRegex.exec(text)) {
    const visiblePart = text.slice(lastIndex, match.index);

    for (let i = 0; i < visiblePart.length && visibleCount < maxVisible; i++) {
      cutIndex = lastIndex + i + 1;
      visibleCount++;
    }
    if (visibleCount >= maxVisible) break;

    cutIndex = match.index + match[0].length;
    lastIndex = ansiRegex.lastIndex;
  }

  if (visibleCount < maxVisible) {
    const remaining = text.slice(lastIndex);
    for (let i = 0; i < remaining.length && visibleCount < maxVisible; i++) {
      cutIndex = lastIndex + i + 1;
      visibleCount++;
    }
  }

  return text.slice(0, cutIndex) + ellipsis + RESET;
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

  if (align === "right") return " ".repeat(padding) + text;

  if (align === "center") {
    const left = Math.floor(padding / 2);
    return " ".repeat(left) + text + " ".repeat(padding - left);
  }

  return text + " ".repeat(padding);
}

/**
 * Wrap text to fit within maxWidth
 * Returns array of lines
 */
export function wrap(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const words = text.split(" ");
  const result: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (visibleLength(current) + 1 + visibleLength(word) <= maxWidth) {
      current += " " + word;
      continue;
    }

    result.push(current);
    current = word;
  }

  if (current) result.push(current);

  return result;
}

/**
 * Repeat a character or string to fill width
 */
export function repeat(char: string, count: number): string {
  return count <= 0 ? "" : char.repeat(count);
}

// Re-export stripAnsi from ansi.ts for consumers that expect it from layout
export { stripAnsi } from "./ansi.ts";

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
