/**
 * Main Menu - Interactive CLI launcher
 */

import { isTTY } from "../utils/index.ts";

// ============================================================================
// ANSI Helpers
// ============================================================================

const ESC = "\x1b";
const rgb = (r: number, g: number, b: number) => (t: string) =>
  `${ESC}[38;2;${r};${g};${b}m${t}${ESC}[0m`;

const BRAND = rgb(0, 163, 244);
const DIM = rgb(113, 113, 122);
const BOLD = (t: string) => `${ESC}[1m${t}${ESC}[0m`;

const hide = `${ESC}[?25l`;
const show = `${ESC}[?25h`;
const up = (n = 1) => `${ESC}[${n}A`;
const clearLine = `${ESC}[2K`;
const col1 = `${ESC}[1G`;

function write(s: string) {
  Deno.stdout.writeSync(new TextEncoder().encode(s));
}

function clear(n: number) {
  for (let i = 0; i < n; i++) write(up() + clearLine);
  write(col1);
}

// ============================================================================
// Random Name Generator
// ============================================================================

const ADJECTIVES = [
  "swift", "bold", "calm", "dark", "epic", "fast", "glad", "hazy", "keen", "lite",
  "mint", "neat", "pale", "pure", "rare", "safe", "slim", "soft", "warm", "wild",
];

const NOUNS = [
  "app", "api", "bot", "box", "hub", "lab", "kit", "pod", "web", "dev",
  "dash", "flow", "link", "node", "port", "sync", "task", "tool", "view", "zone",
];

function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${adj}-${noun}-${suffix}`;
}

// ============================================================================
// Menu Options
// ============================================================================

export type MenuAction = "new" | "dev" | "deploy" | "login" | "help" | "exit";

const MENU_OPTIONS: { id: MenuAction; label: string; desc: string }[] = [
  { id: "new", label: "New Project", desc: "Create a new Veryfront project" },
  { id: "dev", label: "Start Dev", desc: "Start the development server" },
  { id: "deploy", label: "Deploy", desc: "Deploy to production" },
  { id: "login", label: "Login", desc: "Sign in to Veryfront" },
  { id: "help", label: "Help", desc: "Show available commands" },
  { id: "exit", label: "Exit", desc: "Exit the CLI" },
];

// ============================================================================
// Menu UI
// ============================================================================

/**
 * Prompt for project name with inline text input
 * Shows a random default name that can be accepted by pressing Enter
 */
export async function promptProjectName(): Promise<string | null> {
  if (!isTTY()) return null;

  const defaultName = generateRandomName();
  let input = "";
  let lines = 0;

  function draw() {
    if (lines > 0) clear(lines);
    console.log();
    console.log("  " + BOLD("Project name") + " " + DIM("(Enter to accept default)"));
    if (input.length === 0) {
      // Show default as placeholder
      console.log("  " + BRAND("❯") + " " + DIM(defaultName) + BRAND("█"));
    } else {
      console.log("  " + BRAND("❯") + " " + input + BRAND("█"));
    }
    lines = 3;
  }

  write(hide);
  draw();

  Deno.stdin.setRaw(true);
  const reader = Deno.stdin.readable.getReader();
  const dec = new TextDecoder();

  let result: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const key = dec.decode(value);

      // Ctrl+C to cancel
      if (key === "\x03") {
        result = null;
        break;
      }

      // Enter to submit (use default if empty)
      if (key === "\r" || key === "\n") {
        result = input.length > 0 ? input : defaultName;
        break;
      }

      // Backspace
      if (key === "\x7f" || key === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          draw();
        }
        continue;
      }

      // Only allow valid project name characters
      if (/^[a-z0-9-]$/.test(key)) {
        input += key;
        draw();
      }
    }
  } finally {
    reader.releaseLock();
    Deno.stdin.setRaw(false);
  }

  write(show);
  clear(lines);

  if (result) {
    console.log();
    console.log("  " + BOLD("Project name") + " " + BRAND(result));
    console.log();
  }

  return result;
}

export async function showMainMenu(): Promise<MenuAction | null> {
  if (!isTTY()) {
    return null;
  }

  let idx = 0;
  let lines = 0;

  function draw() {
    if (lines > 0) clear(lines);

    // Header
    console.log();
    console.log("  " + BOLD(BRAND("Veryfront")));
    console.log();
    lines = 3;

    // Options
    for (let i = 0; i < MENU_OPTIONS.length; i++) {
      const opt = MENU_OPTIONS[i];
      if (!opt) continue;
      const sel = i === idx;
      const pointer = sel ? BRAND("❯") : " ";
      const label = sel ? BRAND(opt.label) : opt.label;
      const desc = DIM(opt.desc);
      console.log(`  ${pointer} ${label}  ${desc}`);
      lines++;
    }

    console.log();
    console.log("  " + DIM("↑↓ navigate  ⏎ select  q quit"));
    lines += 2;
  }

  write(hide);
  draw();

  Deno.stdin.setRaw(true);
  const reader = Deno.stdin.readable.getReader();
  const dec = new TextDecoder();

  let result: MenuAction | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const key = dec.decode(value);

      // Ctrl+C or q to exit
      if (key === "\x03" || key === "q" || key === "Q") {
        result = "exit";
        break;
      }

      // Enter to select
      if (key === "\r" || key === "\n") {
        const selected = MENU_OPTIONS[idx];
        result = selected?.id ?? null;
        break;
      }

      // Arrow up or k
      if (key === "\x1b[A" || key === "k") {
        idx = idx > 0 ? idx - 1 : MENU_OPTIONS.length - 1;
        draw();
      }

      // Arrow down or j
      if (key === "\x1b[B" || key === "j") {
        idx = idx < MENU_OPTIONS.length - 1 ? idx + 1 : 0;
        draw();
      }
    }
  } finally {
    reader.releaseLock();
    Deno.stdin.setRaw(false);
  }

  write(show);
  clear(lines);

  // Show selection
  if (result && result !== "exit") {
    const selected = MENU_OPTIONS.find((o) => o.id === result);
    if (selected) {
      console.log();
      console.log("  " + BOLD(BRAND("Veryfront")) + "  " + BRAND(selected.label));
      console.log();
    }
  }

  return result;
}
