/****
 * Inline Text Input Component
 *
 * Renders an input prompt at the bottom of the TUI that stays inline
 * without exiting alternate screen mode.
 */

import { brand, dim, muted } from "../../ui/colors.ts";
import type { InputState, LogEntry } from "../state.ts";

export interface InlineInputOptions {
  maxWidth?: number;
}

/**
 * Render the inline input prompt
 */
export function renderInput(input: InputState, _options: InlineInputOptions = {}): string {
  if (!input.active) return "";

  // Build the input line with cursor
  const prompt = `  ${brand(">")} ${input.prompt}: `;
  const beforeCursor = input.value.slice(0, input.cursorPos);
  const cursorChar = input.value[input.cursorPos] ?? " ";
  const afterCursor = input.value.slice(input.cursorPos + 1);

  // Cursor is rendered as inverse video
  const cursor = `\x1b[7m${cursorChar}\x1b[27m`;

  const inputLine = `${prompt}${beforeCursor}${cursor}${afterCursor}`;

  // Hint line
  const hintLine = `  ${dim("Enter")} ${muted("to submit")}  ${dim("Esc")} ${muted("to cancel")}`;

  return `${inputLine}\n${hintLine}`;
}

/**
 * Render the logs area
 */
export function renderLogs(logs: LogEntry[], maxLines: number = 5, maxWidth: number = 80): string {
  if (logs.length === 0) return "";

  const recentLogs = logs.slice(-maxLines);

  return recentLogs
    .map((log) => {
      const time = formatTime(log.time);
      const levelColor = getLevelColor(log.level);
      const levelPrefix = getLevelPrefix(log.level);

      // Truncate message if too long
      const maxMsgLen = maxWidth - 15; // Account for time and level
      const msg = log.message.length > maxMsgLen
        ? `${log.message.slice(0, maxMsgLen - 3)}...`
        : log.message;

      return `  ${dim(time)} ${levelColor(levelPrefix)} ${msg}`;
    })
    .join("\n");
}

/**
 * Format time as HH:MM:SS
 */
function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Get color function for log level
 */
function getLevelColor(level: LogEntry["level"]): (s: string) => string {
  switch (level) {
    case "error":
      return (s: string) => `\x1b[31m${s}\x1b[0m`; // red
    case "warn":
      return (s: string) => `\x1b[33m${s}\x1b[0m`; // yellow
    case "info":
      return (s: string) => `\x1b[36m${s}\x1b[0m`; // cyan
    case "debug":
      return dim;
  }
}

/**
 * Get prefix for log level
 */
function getLevelPrefix(level: LogEntry["level"]): string {
  switch (level) {
    case "error":
      return "ERR";
    case "warn":
      return "WRN";
    case "info":
      return "INF";
    case "debug":
      return "DBG";
  }
}

/**
 * Handle input key press
 * Returns the new value and cursor position, or null if the key should end input
 */
export function handleInputKey(
  key: string,
  value: string,
  cursorPos: number,
): { value: string; cursorPos: number } | { action: "submit" | "cancel" } {
  if (key === "\r" || key === "\n") return { action: "submit" };
  if (key === "\x1b" || key === "\x03") return { action: "cancel" };

  if (key === "\x7f" || key === "\b") {
    if (cursorPos === 0) return { value, cursorPos };

    return {
      value: value.slice(0, cursorPos - 1) + value.slice(cursorPos),
      cursorPos: cursorPos - 1,
    };
  }

  if (key === "\x1b[3~") {
    if (cursorPos >= value.length) return { value, cursorPos };

    return {
      value: value.slice(0, cursorPos) + value.slice(cursorPos + 1),
      cursorPos,
    };
  }

  if (key === "\x1b[D") return { value, cursorPos: Math.max(0, cursorPos - 1) };
  if (key === "\x1b[C") return { value, cursorPos: Math.min(value.length, cursorPos + 1) };
  if (key === "\x01" || key === "\x1b[H") return { value, cursorPos: 0 };
  if (key === "\x05" || key === "\x1b[F") return { value, cursorPos: value.length };
  if (key === "\x15") return { value: "", cursorPos: 0 };

  if (key === "\x17") {
    if (cursorPos === 0) return { value, cursorPos };

    let newPos = cursorPos - 1;
    while (newPos > 0 && value[newPos] === " ") newPos--;
    while (newPos > 0 && value[newPos - 1] !== " ") newPos--;

    return {
      value: value.slice(0, newPos) + value.slice(cursorPos),
      cursorPos: newPos,
    };
  }

  if (key.length === 1 && key >= " " && key <= "~") {
    return {
      value: value.slice(0, cursorPos) + key + value.slice(cursorPos),
      cursorPos: cursorPos + 1,
    };
  }

  return { value, cursorPos };
}
