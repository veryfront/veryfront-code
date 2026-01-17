/**
 * CLI wizard for `new` command
 * Standard select/multi-select with Veryfront agent logo
 */

import { writeStdout } from "@veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "@veryfront/platform/compat/stdin.ts";
import type { InitTemplate } from "./init/types.ts";
import type { IntegrationName } from "../templates/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface NewTuiResult {
  template: InitTemplate;
  integrations: IntegrationName[];
  cancelled: boolean;
}

// ============================================================================
// Brand Colors (24-bit RGB)
// ============================================================================

const ESC = "\x1b";
const rgb = (r: number, g: number, b: number) => (t: string) =>
  `${ESC}[38;2;${r};${g};${b}m${t}${ESC}[0m`;

const BRAND = rgb(0, 163, 244); // #00A3F4
const GREEN = rgb(34, 197, 94);
const DIM = rgb(113, 113, 122);
const BOLD = (t: string) => `${ESC}[1m${t}${ESC}[0m`;

// ============================================================================
// Data
// ============================================================================

const TEMPLATES: { id: InitTemplate; label: string }[] = [
  { id: "ai", label: "AI Agent" },
  { id: "app", label: "Full App" },
  { id: "blog", label: "Blog" },
  { id: "docs", label: "Documentation" },
  { id: "minimal", label: "Minimal" },
];

const INTEGRATIONS: { id: IntegrationName; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "slack", label: "Slack" },
  { id: "notion", label: "Notion" },
  { id: "github", label: "GitHub" },
  { id: "calendar", label: "Calendar" },
  { id: "drive", label: "Google Drive" },
  { id: "jira", label: "Jira" },
  { id: "linear", label: "Linear" },
];

// ============================================================================
// Terminal Helpers
// ============================================================================

const hide = `${ESC}[?25l`;
const show = `${ESC}[?25h`;
const up = (n = 1) => `${ESC}[${n}A`;
const clearLine = `${ESC}[2K`;
const col1 = `${ESC}[1G`;

function write(s: string) {
  writeStdout(s);
}

function clear(n: number) {
  for (let i = 0; i < n; i++) write(up() + clearLine);
  write(col1);
}

// ============================================================================
// Standard Select
// ============================================================================

async function select<T extends string>(
  label: string,
  options: { id: T; label: string }[],
): Promise<T | null> {
  let idx = 0;
  let lines = 0;

  function draw() {
    if (lines > 0) clear(lines);
    console.log(DIM("?") + " " + BOLD(label));
    lines = 1;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const sel = i === idx;
      console.log(`  ${sel ? BRAND("❯") : " "} ${sel ? BRAND(opt.label) : DIM(opt.label)}`);
      lines++;
    }
  }

  write(hide);
  draw();

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const key = dec.decode(value);

      if (key === "\x03") {
        reader.releaseLock();
        setRawMode(false);
        write(show);
        clear(lines);
        return null;
      }
      if (key === "\r" || key === "\n") break;
      if (key === "\x1b[A" || key === "k") {
        idx = idx > 0 ? idx - 1 : options.length - 1;
        draw();
      }
      if (key === "\x1b[B" || key === "j") {
        idx = idx < options.length - 1 ? idx + 1 : 0;
        draw();
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }

  write(show);
  clear(lines);
  const selected = options[idx];
  console.log(DIM("?") + " " + BOLD(label) + " " + BRAND(selected?.label ?? ""));
  return selected?.id ?? null;
}

// ============================================================================
// Standard Multi-Select
// ============================================================================

async function multiSelect<T extends string>(
  label: string,
  options: { id: T; label: string }[],
): Promise<T[] | null> {
  let idx = 0;
  const picked = new Set<T>();
  let lines = 0;

  function draw() {
    if (lines > 0) clear(lines);
    console.log(DIM("?") + " " + BOLD(label) + DIM(" (space to toggle, enter to confirm)"));
    lines = 1;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const focus = i === idx;
      const on = picked.has(opt.id);
      const check = on ? GREEN("◉") : DIM("○");
      const text = focus ? (on ? GREEN(opt.label) : opt.label) : DIM(opt.label);
      console.log(`  ${focus ? BRAND("❯") : " "} ${check} ${text}`);
      lines++;
    }
  }

  write(hide);
  draw();

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const key = dec.decode(value);

      if (key === "\x03") {
        reader.releaseLock();
        setRawMode(false);
        write(show);
        clear(lines);
        return null;
      }
      if (key === "\r" || key === "\n") break;
      if (key === " ") {
        const opt = options[idx];
        if (opt) {
          if (picked.has(opt.id)) picked.delete(opt.id);
          else picked.add(opt.id);
          draw();
        }
      }
      if (key === "\x1b[A" || key === "k") {
        idx = idx > 0 ? idx - 1 : options.length - 1;
        draw();
      }
      if (key === "\x1b[B" || key === "j") {
        idx = idx < options.length - 1 ? idx + 1 : 0;
        draw();
      }
      if (key === "a") {
        if (picked.size === options.length) picked.clear();
        else options.forEach((o) => picked.add(o.id));
        draw();
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }

  write(show);
  clear(lines);
  const labels = options.filter((o) => picked.has(o.id)).map((o) => o.label);
  console.log(
    DIM("?") + " " + BOLD(label) + " " + (labels.length ? BRAND(labels.join(", ")) : DIM("none")),
  );
  return Array.from(picked);
}

// ============================================================================
// Main TUI
// ============================================================================

export async function runNewTui(projectName: string, _userEmail?: string): Promise<NewTuiResult> {
  console.log();
  console.log("  Creating " + BRAND(projectName));
  console.log();

  // Template selection
  const template = await select("Template", TEMPLATES);
  if (!template) return { template: "ai", integrations: [], cancelled: true };

  console.log();

  // Integration selection
  const integrations = await multiSelect("Integrations", INTEGRATIONS);
  if (!integrations) return { template, integrations: [], cancelled: true };

  console.log();

  return { template, integrations, cancelled: false };
}
