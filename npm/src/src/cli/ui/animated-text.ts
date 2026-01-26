/**
 * Animated text output utilities for CLI demos
 *
 * @module cli/ui/animated-text
 */
import * as dntShim from "../../../_dnt.shims.js";


import { writeStdout } from "../../platform/compat/process.js";
import { brand } from "./colors.js";
import { cursor } from "./ansi.js";
import { TYPEWRITER_CHAR_DELAY_MS, TYPEWRITER_WORD_DELAY_MS } from "./constants.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
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

  if (hideCursor) writeStdout(cursor.hide);

  try {
    if (mode === "word") {
      const words = text.split(" ");
      for (let i = 0; i < words.length; i++) {
        writeStdout(words[i] + (i < words.length - 1 ? " " : ""));
        await delay(wordDelay);
      }
      return;
    }

    for (const char of text) {
      writeStdout(char);
      await delay(charDelay);
    }
  } finally {
    if (hideCursor) writeStdout(cursor.show);
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
  writeStdout("\n");
}

/**
 * Display a command with special formatting ($ prefix)
 */
export async function typeCommand(
  command: string,
  options?: TypewriterOptions,
): Promise<void> {
  writeStdout(`  ${brand("$")} `);
  await typeText(command, { ...options, charDelay: options?.charDelay ?? 50 });
  writeStdout("\n");
}

// Re-export cursor controls for backwards compatibility
export const HIDE_CURSOR = cursor.hide;
export const SHOW_CURSOR = cursor.show;
