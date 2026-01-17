/**
 * Veryfront CLI TUI
 * Shared UI for new/dev commands with collapsible logs
 */

import { getTerminalSize, writeStdout } from "@veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "@veryfront/platform/compat/stdin.ts";
import { brand, dim, error, muted, success } from "./colors.ts";
import { ANSI_REGEX, cursor, getSpinnerFrame, screen, SPINNER_FRAMES } from "./ansi.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  SPINNER_INTERVAL_MS,
} from "./constants.ts";

// No static logo - using animated matrix instead

export interface TuiConfig {
  title?: string;
  subtitle?: string;
  showLogs?: boolean;
}

export interface TuiState {
  status: string;
  statusType: "loading" | "success" | "error" | "info";
  steps: { label: string; done: boolean }[];
  currentStep: number;
  info: Record<string, string>;
  logs: string[];
  logsExpanded: boolean;
  logScroll: number;
}

let state: TuiState;
let config: TuiConfig;
let spinnerFrame = 0;
let spinnerInterval: number | null = null;
let termH = DEFAULT_TERMINAL_HEIGHT;
let termW = DEFAULT_TERMINAL_WIDTH;

/** Write to stdout (alias for consistency with existing code) */
const write = writeStdout;

function getSize() {
  try {
    const { rows, columns } = getTerminalSize();
    termH = rows;
    termW = columns;
  } catch { /* use defaults */ }
}

function render() {
  getSize();
  const lines: string[] = [];

  // Spacing
  lines.push("");

  // Info section
  const infoKeys = Object.keys(state.info);
  if (infoKeys.length > 0) {
    const maxKeyLen = Math.max(...infoKeys.map((k) => k.length));
    for (const key of infoKeys) {
      const padding = " ".repeat(maxKeyLen - key.length);
      // Info values can include pre-styled content (e.g., green dots)
      lines.push("  " + dim(key) + padding + "  " + (state.info[key] ?? ""));
    }
    lines.push("");
  }

  // Steps (if any)
  if (state.steps.length > 0) {
    const spinner = getSpinnerFrame(spinnerFrame);
    const stepLine = state.steps.map((s, i) => {
      const icon = s.done ? success("✓") : (i === state.currentStep ? brand(spinner) : dim("○"));
      const text = s.done ? dim(s.label) : s.label;
      return icon + " " + text;
    }).join("  ");
    lines.push("  " + stepLine);
    lines.push("");
  }

  // Status
  let statusIcon: string;
  const spinnerChar = getSpinnerFrame(spinnerFrame);
  switch (state.statusType) {
    case "loading":
      statusIcon = brand(spinnerChar);
      break;
    case "success":
      statusIcon = success("●");
      break;
    case "error":
      statusIcon = error("✗");
      break;
    default:
      statusIcon = dim("○");
  }
  lines.push("  " + statusIcon + " " + state.status);
  lines.push("");

  // Help
  const helpParts: string[] = [];
  if (state.statusType === "success" && state.status.includes("Ready")) {
    helpParts.push(dim("enter") + " deploy");
  }
  if (config.showLogs !== false) {
    helpParts.push(dim("l") + " logs");
  }
  helpParts.push(dim("ctrl+c") + " exit");
  lines.push("  " + helpParts.join("  "));
  lines.push("");

  // Logs section
  if (config.showLogs !== false) {
    const logIcon = state.logsExpanded ? "▼" : "▶";
    lines.push("  " + dim(logIcon + " Logs") + dim(` (${state.logs.length})`));

    if (state.logsExpanded && state.logs.length > 0) {
      const maxLogLines = Math.max(5, termH - lines.length - 3);
      const start = Math.max(0, state.logs.length - maxLogLines - state.logScroll);
      const end = state.logs.length - state.logScroll;
      const visible = state.logs.slice(start, end);

      for (const log of visible) {
        const truncated = log.length > termW - 6 ? log.slice(0, termW - 9) + "..." : log;
        lines.push("    " + muted(truncated));
      }

      if (state.logs.length > maxLogLines) {
        lines.push("    " + dim(`↑↓ scroll`));
      }
    }
  }

  // Render to screen
  write(cursor.moveTo(1, 1) + screen.clearDown);
  for (let i = 0; i < lines.length; i++) {
    write(cursor.moveTo(i + 1, 1) + screen.clearLine + lines[i]);
  }
}

function startSpinner() {
  if (spinnerInterval) return;
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    render();
  }, SPINNER_INTERVAL_MS);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

export function createTui(cfg: TuiConfig = {}) {
  config = { title: "Veryfront", showLogs: true, ...cfg };
  state = {
    status: "Initializing...",
    statusType: "loading",
    steps: [],
    currentStep: 0,
    info: {},
    logs: [],
    logsExpanded: false,
    logScroll: 0,
  };

  write(screen.altOn + cursor.hide);
  startSpinner();
  render();

  return {
    setInfo(info: Record<string, string>) {
      state.info = info;
      render();
    },

    setSteps(steps: string[]) {
      state.steps = steps.map((label) => ({ label, done: false }));
      state.currentStep = 0;
      render();
    },

    completeStep() {
      const step = state.steps[state.currentStep];
      if (step) {
        step.done = true;
        state.currentStep++;
        render();
      }
    },

    setStatus(status: string, type: TuiState["statusType"] = "info") {
      state.status = status;
      state.statusType = type;
      if (type !== "loading") stopSpinner();
      else startSpinner();
      render();
    },

    addLog(msg: string) {
      const clean = msg.replace(ANSI_REGEX, "").trim();
      if (clean) {
        state.logs.push(clean);
        if (state.logsExpanded) render();
      }
    },

    toggleLogs() {
      state.logsExpanded = !state.logsExpanded;
      state.logScroll = 0;
      render();
    },

    scrollLogs(dir: "up" | "down") {
      if (!state.logsExpanded) return;
      if (dir === "up" && state.logScroll < state.logs.length - 5) state.logScroll++;
      if (dir === "down" && state.logScroll > 0) state.logScroll--;
      render();
    },

    cleanup() {
      stopSpinner();
      write(cursor.show + screen.altOff);
    },

    render,
  };
}

export type Tui = ReturnType<typeof createTui>;

// Console interceptor
export function interceptConsole(tui: Tui) {
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const capture = (...args: unknown[]) => {
    tui.addLog(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
  };
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  console.info = capture;
  return () => Object.assign(console, orig);
}

// Keyboard handler
export async function handleInput(tui: Tui, opts: {
  onEnter?: () => void;
  onExit?: () => void;
}) {
  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const key = dec.decode(value);

      if (key === "\x03") {
        opts.onExit?.();
        break;
      }
      if (key === "\r" || key === "\n") {
        opts.onEnter?.();
        break;
      }
      if (key === "l" || key === "L") tui.toggleLogs();
      if (key === "\x1b[A" || key === "k") tui.scrollLogs("up");
      if (key === "\x1b[B" || key === "j") tui.scrollLogs("down");
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}
