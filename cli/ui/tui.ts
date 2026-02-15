/**************************
 * Veryfront CLI TUI
 * Shared UI for new/dev commands with collapsible logs
 **************************/

import { getTerminalSize, writeStdout } from "veryfront/platform";
import { getStdinReader, setRawMode } from "veryfront/platform";
import { brand, dim, error, muted, success } from "./colors.ts";
import { ANSI_REGEX, cursor, getSpinnerFrame, screen, SPINNER_FRAMES } from "./ansi.ts";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  SPINNER_INTERVAL_MS,
} from "./constants.ts";

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

const write = writeStdout;

function getSize(): void {
  try {
    const { rows, columns } = getTerminalSize();
    termH = rows;
    termW = columns;
  } catch {
    // use defaults
  }
}

function render(): void {
  getSize();
  const lines: string[] = [""];

  const infoKeys = Object.keys(state.info);
  if (infoKeys.length > 0) {
    const maxKeyLen = Math.max(...infoKeys.map((k) => k.length));
    for (const key of infoKeys) {
      const padding = " ".repeat(maxKeyLen - key.length);
      lines.push(`  ${dim(key)}${padding}  ${state.info[key] ?? ""}`);
    }
    lines.push("");
  }

  if (state.steps.length > 0) {
    const spinner = getSpinnerFrame(spinnerFrame);
    const stepLine = state.steps
      .map((s, i) => {
        const icon = s.done ? success("✓") : i === state.currentStep ? brand(spinner) : dim("○");
        const text = s.done ? dim(s.label) : s.label;
        return `${icon} ${text}`;
      })
      .join("  ");
    lines.push(`  ${stepLine}`, "");
  }

  const spinnerChar = getSpinnerFrame(spinnerFrame);
  let statusIcon = dim("○");
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
  }

  lines.push(`  ${statusIcon} ${state.status}`, "");

  const helpParts: string[] = [];
  if (state.statusType === "success" && state.status.includes("Ready")) {
    helpParts.push(dim("enter") + " deploy");
  }
  if (config.showLogs !== false) helpParts.push(dim("l") + " logs");
  helpParts.push(dim("ctrl+c") + " exit");
  lines.push(`  ${helpParts.join("  ")}`, "");

  if (config.showLogs !== false) {
    const logIcon = state.logsExpanded ? "▼" : "▶";
    lines.push(`  ${dim(`${logIcon} Logs`)}${dim(` (${state.logs.length})`)}`);

    if (state.logsExpanded && state.logs.length > 0) {
      const maxLogLines = Math.max(5, termH - lines.length - 3);
      const start = Math.max(0, state.logs.length - maxLogLines - state.logScroll);
      const end = state.logs.length - state.logScroll;
      const visible = state.logs.slice(start, end);

      for (const log of visible) {
        const maxWidth = termW - 6;
        const truncated = log.length > maxWidth ? log.slice(0, termW - 9) + "..." : log;
        lines.push(`    ${muted(truncated)}`);
      }

      if (state.logs.length > maxLogLines) lines.push(`    ${dim("↑↓ scroll")}`);
    }
  }

  write(cursor.moveTo(1, 1) + screen.clearDown);
  for (let i = 0; i < lines.length; i++) {
    write(cursor.moveTo(i + 1, 1) + screen.clearLine + lines[i]);
  }
}

function startSpinner(): void {
  if (spinnerInterval) return;

  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    render();
  }, SPINNER_INTERVAL_MS);
}

function stopSpinner(): void {
  if (!spinnerInterval) return;
  clearInterval(spinnerInterval);
  spinnerInterval = null;
}

export function createTui(cfg: TuiConfig = {}): {
  setInfo: (info: Record<string, string>) => void;
  setSteps: (steps: string[]) => void;
  completeStep: () => void;
  setStatus: (status: string, type?: TuiState["statusType"]) => void;
  addLog: (msg: string) => void;
  toggleLogs: () => void;
  scrollLogs: (dir: "up" | "down") => void;
  cleanup: () => void;
  render: () => void;
} {
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

  function setInfo(info: Record<string, string>): void {
    state.info = info;
    render();
  }

  function setSteps(steps: string[]): void {
    state.steps = steps.map((label) => ({ label, done: false }));
    state.currentStep = 0;
    render();
  }

  function completeStep(): void {
    const step = state.steps[state.currentStep];
    if (!step) return;

    step.done = true;
    state.currentStep++;
    render();
  }

  function setStatus(status: string, type: TuiState["statusType"] = "info"): void {
    state.status = status;
    state.statusType = type;

    if (type === "loading") startSpinner();
    else stopSpinner();

    render();
  }

  function addLog(msg: string): void {
    const clean = msg.replace(ANSI_REGEX, "").trim();
    if (!clean) return;

    state.logs.push(clean);
    if (state.logsExpanded) render();
  }

  function toggleLogs(): void {
    state.logsExpanded = !state.logsExpanded;
    state.logScroll = 0;
    render();
  }

  function scrollLogs(dir: "up" | "down"): void {
    if (!state.logsExpanded) return;

    if (dir === "up") {
      if (state.logScroll < state.logs.length - 5) state.logScroll++;
      render();
      return;
    }

    if (state.logScroll > 0) state.logScroll--;
    render();
  }

  function cleanup(): void {
    stopSpinner();
    write(cursor.show + screen.altOff);
  }

  return {
    setInfo,
    setSteps,
    completeStep,
    setStatus,
    addLog,
    toggleLogs,
    scrollLogs,
    cleanup,
    render,
  };
}

export type Tui = ReturnType<typeof createTui>;

export function interceptConsole(tui: Tui): () => void {
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };

  function capture(...args: unknown[]): void {
    tui.addLog(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  }

  console.log = capture;
  console.error = capture;
  console.warn = capture;
  console.info = capture;

  return () => Object.assign(console, orig);
}

export async function handleInput(
  tui: Tui,
  opts: { onEnter?: () => void; onExit?: () => void },
): Promise<void> {
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

      if (key === "l" || key === "L") {
        tui.toggleLogs();
        continue;
      }

      if (key === "\x1b[A" || key === "k") {
        tui.scrollLogs("up");
        continue;
      }

      if (key === "\x1b[B" || key === "j") {
        tui.scrollLogs("down");
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}
