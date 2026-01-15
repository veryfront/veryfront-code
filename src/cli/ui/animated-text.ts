/**
 * Animated text output utilities for CLI demos
 *
 * @module cli/ui/animated-text
 */

import { brand } from "./colors.ts";

// ANSI escape codes
const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

function write(s: string): void {
  Deno.stdout.writeSync(new TextEncoder().encode(s));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TypewriterOptions {
  /** Delay between characters in ms (default: 30) */
  charDelay?: number;
  /** Delay between words in ms when using word mode (default: 100) */
  wordDelay?: number;
  /** Animation mode: 'char' or 'word' (default: 'char') */
  mode?: "char" | "word";
  /** Whether to hide cursor during animation (default: true) */
  hideCursor?: boolean;
}

/**
 * Type text with animated effect
 */
export async function typeText(
  text: string,
  options: TypewriterOptions = {},
): Promise<void> {
  const {
    charDelay = 30,
    wordDelay = 100,
    mode = "char",
    hideCursor = true,
  } = options;

  if (hideCursor) write(HIDE_CURSOR);

  try {
    if (mode === "word") {
      const words = text.split(" ");
      for (let i = 0; i < words.length; i++) {
        write(words[i] + (i < words.length - 1 ? " " : ""));
        await delay(wordDelay);
      }
    } else {
      for (const char of text) {
        write(char);
        await delay(charDelay);
      }
    }
  } finally {
    if (hideCursor) write(SHOW_CURSOR);
  }
}

/**
 * Type a line with newline at end
 */
export async function typeLine(
  text: string,
  options?: TypewriterOptions,
): Promise<void> {
  await typeText(text, options);
  write("\n");
}

/**
 * Display a command with special formatting ($ prefix)
 */
export async function typeCommand(
  command: string,
  options?: TypewriterOptions,
): Promise<void> {
  write("  " + brand("$") + " ");
  await typeText(command, { ...options, charDelay: options?.charDelay ?? 50 });
  write("\n");
}

export { HIDE_CURSOR, SHOW_CURSOR };
