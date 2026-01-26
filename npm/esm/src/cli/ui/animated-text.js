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
function delay(ms) {
    return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
}
/**
 * Type text with animated effect
 */
export async function typeText(text, options = {}) {
    const { charDelay = TYPEWRITER_CHAR_DELAY_MS, wordDelay = TYPEWRITER_WORD_DELAY_MS, mode = "char", hideCursor = true, } = options;
    if (hideCursor)
        writeStdout(cursor.hide);
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
    }
    finally {
        if (hideCursor)
            writeStdout(cursor.show);
    }
}
/**
 * Type a line with newline at end
 */
export async function typeLine(text, options) {
    await typeText(text, options);
    writeStdout("\n");
}
/**
 * Display a command with special formatting ($ prefix)
 */
export async function typeCommand(command, options) {
    writeStdout(`  ${brand("$")} `);
    await typeText(command, { ...options, charDelay: options?.charDelay ?? 50 });
    writeStdout("\n");
}
// Re-export cursor controls for backwards compatibility
export const HIDE_CURSOR = cursor.hide;
export const SHOW_CURSOR = cursor.show;
