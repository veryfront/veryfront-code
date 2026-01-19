/**
 * Animated text output utilities for CLI demos
 *
 * @module cli/ui/animated-text
 */

import { writeStdout } from "#veryfront/platform/compat/process.ts";
import { brand } from "./colors.ts";
import { cursor } from "./ansi.ts";
import { TYPEWRITER_CHAR_DELAY_MS, TYPEWRITER_WORD_DELAY_MS } from "./constants.ts";

/** Write to stdout (alias for consistency with existing code) */
const write = writeStdout;

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
    charDelay = TYPEWRITER_CHAR_DELAY_MS,
    wordDelay = TYPEWRITER_WORD_DELAY_MS,
    mode = "char",
    hideCursor = true,
  } = options;

  if (hideCursor) write(cursor.hide);

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
    if (hideCursor) write(cursor.show);
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

// Re-export cursor controls for backwards compatibility
export const HIDE_CURSOR = cursor.hide;
export const SHOW_CURSOR = cursor.show;
