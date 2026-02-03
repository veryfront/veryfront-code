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
export function renderInput(
  input: InputState,
  _options: InlineInputOptions = {},
): string {
  if (!input.active) return "";

  const prompt = `  ${brand(">")} ${input.prompt}: `;
  const beforeCursor = input.value.slice(0, input.cursorPos);
  const cursorChar = input.value[input.cursorPos] ?? " ";
  const afterCursor = input.value.slice(input.cursorPos + 1);

  // Cursor is rendered as inverse video
  const cursor = `\x1b[7m${cursorChar}\x1b[27m`;

  const inputLine = `${prompt}${beforeCursor}${cursor}${afterCursor}`;
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
export function renderLogs(logs: LogEntry[], options: RenderLogsOptions = {}): string {
  if (logs.length === 0) return "";

  const { maxLines = 5, maxWidth = 80, scroll = 0, expanded = false } = options;

  const visibleLines = expanded ? Math.max(maxLines, 15) : maxLines;
  const end = logs.length - scroll;
  const start = Math.max(0, end - visibleLines);
  const visibleLogs = logs.slice(start, end);

  const lines: string[] = [];

  for (const log of visibleLogs) {
    const time = formatTime(log.time);
    const levelColor = getLevelColor(log.level);
    const levelPrefix = getLevelPrefix(log.level);

    if (!expanded) {
      const maxMsgLen = maxWidth - 15;
      const msg = log.message.length > maxMsgLen
        ? `${log.message.slice(0, maxMsgLen - 3)}...`
        : log.message;

      lines.push(`  ${dim(time)} ${levelColor(levelPrefix)} ${msg}`);
      continue;
    }

    const meta = log.meta;
    if (meta?.method) {
      const status = meta.status || 200;
      const statusColor = getStatusColor(status);
      const methodStr = (meta.method || "GET").padEnd(7);
      const pathStr = meta.path || "/";
      const statusStr = String(status);
      const durationStr = `${meta.durationMs || 0}ms`.padStart(6);

      lines.push(`  ${dim(time)} ${levelColor(levelPrefix)} ${methodStr}${pathStr}`);

      const projectInfo: string[] = [];
      if (meta.project) projectInfo.push(brand(meta.project));
      if (meta.env) projectInfo.push(dim(meta.env));
      if (meta.releaseId) projectInfo.push(dim(`#${meta.releaseId.slice(0, 8)}`));

      lines.push(
        `  ${"".padEnd(12)}${statusColor(statusStr)} ${dim(durationStr)}${
          projectInfo.length ? `  ${projectInfo.join(" ")}` : ""
        }`,
      );
      continue;
    }

    // Parse message and metadata (key=value pairs)
    const { message: mainMsg, metadata } = parseLogMessage(log.message);
    const prefix = `  ${dim(time)} ${levelColor(levelPrefix)} `;

    // Show main message (truncated if needed)
    const maxMsgWidth = maxWidth - 15;
    const truncatedMsg = mainMsg.length > maxMsgWidth
      ? `${mainMsg.slice(0, maxMsgWidth - 3)}...`
      : mainMsg;
    lines.push(`${prefix}${truncatedMsg}`);

    // Show metadata on separate indented lines (dimmed)
    if (expanded && metadata.length > 0) {
      const metaIndent = "  " + "".padEnd(12);
      for (const [key, value] of metadata) {
        const shortValue = shortenValue(value);
        lines.push(`${metaIndent}${dim(`${key}=${shortValue}`)}`);
      }
    }
  }

  if (expanded && logs.length > visibleLines) {
    const scrollHint: string[] = [];
    if (start > 0) scrollHint.push("↑");
    if (scroll > 0) scrollHint.push("↓");

    if (scrollHint.length) {
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
 * Parse log message to extract main message and key=value metadata
 */
function parseLogMessage(text: string): { message: string; metadata: [string, string][] } {
  // Match key=value or key="quoted value" patterns
  const metaRegex = /\s+(\w+)=((?:"[^"]*")|(?:\{[^}]*\})|(?:\[[^\]]*\])|(?:[^\s]+))/g;

  // Find first key=value to split message from metadata
  const firstMatch = text.match(/\s+\w+=/);
  if (!firstMatch || firstMatch.index === undefined) {
    return { message: text, metadata: [] };
  }

  const message = text.slice(0, firstMatch.index).trim();
  const metaPart = text.slice(firstMatch.index);

  const metadata: [string, string][] = [];
  let match;
  while ((match = metaRegex.exec(metaPart)) !== null) {
    if (match[1] && match[2]) {
      metadata.push([match[1], match[2]]);
    }
  }

  return { message, metadata };
}

/**
 * Shorten long values (paths, JSON) for display
 */
function shortenValue(value: string): string {
  // Remove surrounding quotes
  const unquoted = value.replace(/^"|"$/g, "");

  // Shorten home directory paths
  const home = Deno.env.get("HOME") || "";
  if (home && unquoted.startsWith(home)) {
    return "~" + unquoted.slice(home.length);
  }

  // Truncate very long values
  if (unquoted.length > 50) {
    return unquoted.slice(0, 47) + "...";
  }

  return unquoted;
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
