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

export interface RenderLogsOptions {
  maxLines?: number;
  maxWidth?: number;
  scroll?: number;
  expanded?: boolean;
}

/**
 * Render the logs area with optional scrolling
 */
export function renderLogs(
  logs: LogEntry[],
  options: RenderLogsOptions = {},
): string {
  const { maxLines = 5, maxWidth = 80, scroll = 0, expanded = false } = options;

  if (logs.length === 0) return "";

  const visibleLines = expanded ? Math.max(maxLines, 15) : maxLines;
  const end = logs.length - scroll;
  const start = Math.max(0, end - visibleLines);
  const visibleLogs = logs.slice(start, end);

  const lines: string[] = [];

  for (const log of visibleLogs) {
    const time = formatTime(log.time);
    const levelColor = getLevelColor(log.level);
    const levelPrefix = getLevelPrefix(log.level);

    if (expanded) {
      // When expanded, show structured info if available
      if (log.meta?.method) {
        // Request log - show all details in clean format
        const meta = log.meta;
        const statusColor = getStatusColor(meta.status || 200);
        const methodStr = (meta.method || "GET").padEnd(7);
        const pathStr = meta.path || "/";
        const statusStr = String(meta.status || 200);
        const durationStr = `${meta.durationMs || 0}ms`.padStart(6);

        // Line 1: time + method + path
        lines.push(
          `  ${dim(time)} ${levelColor(levelPrefix)} ${methodStr}${pathStr}`,
        );

        // Line 2: status + duration + project info
        const projectInfo: string[] = [];
        if (meta.project) projectInfo.push(brand(meta.project));
        if (meta.env) projectInfo.push(dim(meta.env));
        if (meta.releaseId) projectInfo.push(dim(`#${meta.releaseId.slice(0, 8)}`));

        lines.push(
          `  ${"".padEnd(12)}${statusColor(statusStr)} ${dim(durationStr)}${
            projectInfo.length ? `  ${projectInfo.join(" ")}` : ""
          }`,
        );
      } else {
        // Regular log - show full message (may wrap to multiple lines)
        const prefix = `  ${dim(time)} ${levelColor(levelPrefix)} `;
        const msgLines = wrapText(log.message, maxWidth - 15);
        lines.push(`${prefix}${msgLines[0] || ""}`);
        // Indent continuation lines
        for (let i = 1; i < msgLines.length; i++) {
          lines.push(`  ${"".padEnd(12)}${msgLines[i]}`);
        }
      }
    } else {
      // When collapsed, truncate
      const maxMsgLen = maxWidth - 15;
      const msg = log.message.length > maxMsgLen
        ? `${log.message.slice(0, maxMsgLen - 3)}...`
        : log.message;
      lines.push(`  ${dim(time)} ${levelColor(levelPrefix)} ${msg}`);
    }
  }

  if (expanded && logs.length > visibleLines) {
    const canScrollUp = start > 0;
    const canScrollDown = scroll > 0;
    const scrollHint = [];
    if (canScrollUp) scrollHint.push("↑");
    if (canScrollDown) scrollHint.push("↓");
    if (scrollHint.length > 0) {
      lines.push(`  ${dim(`[${scrollHint.join(" ")}] ${logs.length} total`)}`);
    }
  }

  return lines.join("\n");
}

function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > maxWidth) {
    let breakPoint = remaining.lastIndexOf(" ", maxWidth);
    if (breakPoint <= 0) breakPoint = maxWidth;
    lines.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  if (remaining) lines.push(remaining);
  return lines;
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
 * Get color function for HTTP status code
 */
function getStatusColor(status: number): (s: string) => string {
  if (status >= 500) return (s: string) => `\x1b[31m${s}\x1b[0m`; // red
  if (status >= 400) return (s: string) => `\x1b[33m${s}\x1b[0m`; // yellow
  if (status >= 300) return (s: string) => `\x1b[36m${s}\x1b[0m`; // cyan
  return (s: string) => `\x1b[32m${s}\x1b[0m`; // green
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
