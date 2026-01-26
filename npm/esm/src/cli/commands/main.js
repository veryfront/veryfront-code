/**************************
 * Main Menu - Interactive CLI launcher
 **************************/
import { writeStdout } from "../../platform/compat/process.js";
import { getStdinReader, setRawMode } from "../../platform/compat/stdin.js";
import { isTTY } from "../utils/index.js";
import { bold, brand, muted } from "../ui/colors.js";
// ============================================================================
// Terminal Control
// ============================================================================
const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;
const COL_1 = `${ESC}[1G`;
function moveUp(n = 1) {
    return `${ESC}[${n}A`;
}
function write(s) {
    writeStdout(s);
}
function clearLines(n) {
    for (let i = 0; i < n; i++)
        write(moveUp() + CLEAR_LINE);
    write(COL_1);
}
// ============================================================================
// Random Name Generator
// ============================================================================
const ADJECTIVES = [
    "swift",
    "bold",
    "calm",
    "dark",
    "epic",
    "fast",
    "glad",
    "hazy",
    "keen",
    "lite",
    "mint",
    "neat",
    "pale",
    "pure",
    "rare",
    "safe",
    "slim",
    "soft",
    "warm",
    "wild",
];
const NOUNS = [
    "app",
    "api",
    "bot",
    "box",
    "hub",
    "lab",
    "kit",
    "pod",
    "web",
    "dev",
    "dash",
    "flow",
    "link",
    "node",
    "port",
    "sync",
    "task",
    "tool",
    "view",
    "zone",
];
function generateRandomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${adj}-${noun}-${suffix}`;
}
const MENU_OPTIONS = [
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
export async function promptProjectName() {
    if (!isTTY())
        return null;
    const defaultName = generateRandomName();
    let input = "";
    let lines = 0;
    function draw() {
        if (lines > 0)
            clearLines(lines);
        console.log();
        console.log("  " + bold("Project name") + " " + muted("(Enter to accept default)"));
        console.log("  " + brand("❯") + " " + (input.length === 0 ? muted(defaultName) : input) + brand("█"));
        lines = 3;
    }
    write(HIDE_CURSOR);
    draw();
    setRawMode(true);
    const reader = getStdinReader();
    const dec = new TextDecoder();
    let result = null;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            const key = dec.decode(value);
            if (key === "\x03") {
                result = null;
                break;
            }
            if (key === "\r" || key === "\n") {
                result = input.length > 0 ? input : defaultName;
                break;
            }
            if (key === "\x7f" || key === "\b") {
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    draw();
                }
                continue;
            }
            if (/^[a-z0-9-]$/.test(key)) {
                input += key;
                draw();
            }
        }
    }
    finally {
        reader.releaseLock();
        setRawMode(false);
    }
    write(SHOW_CURSOR);
    clearLines(lines);
    if (result) {
        console.log();
        console.log("  " + bold("Project name") + " " + brand(result));
        console.log();
    }
    return result;
}
export async function showMainMenu() {
    if (!isTTY())
        return null;
    let idx = 0;
    let lines = 0;
    function draw() {
        if (lines > 0)
            clearLines(lines);
        console.log();
        console.log("  " + bold(brand("Veryfront")));
        console.log();
        lines = 3;
        for (let i = 0; i < MENU_OPTIONS.length; i++) {
            const opt = MENU_OPTIONS[i];
            const selected = i === idx;
            const pointer = selected ? brand("❯") : " ";
            const label = selected ? brand(opt.label) : opt.label;
            console.log(`  ${pointer} ${label}  ${muted(opt.desc)}`);
            lines++;
        }
        console.log();
        console.log("  " + muted("↑↓ navigate  ⏎ select  q quit"));
        lines += 2;
    }
    write(HIDE_CURSOR);
    draw();
    setRawMode(true);
    const reader = getStdinReader();
    const dec = new TextDecoder();
    let result = null;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            const key = dec.decode(value);
            if (key === "\x03" || key === "q" || key === "Q") {
                result = "exit";
                break;
            }
            if (key === "\r" || key === "\n") {
                result = MENU_OPTIONS[idx]?.id ?? null;
                break;
            }
            if (key === "\x1b[A" || key === "k") {
                idx = idx > 0 ? idx - 1 : MENU_OPTIONS.length - 1;
                draw();
                continue;
            }
            if (key === "\x1b[B" || key === "j") {
                idx = idx < MENU_OPTIONS.length - 1 ? idx + 1 : 0;
                draw();
            }
        }
    }
    finally {
        reader.releaseLock();
        setRawMode(false);
    }
    write(SHOW_CURSOR);
    clearLines(lines);
    if (result && result !== "exit") {
        const selected = MENU_OPTIONS.find((o) => o.id === result);
        if (selected) {
            console.log();
            console.log("  " + bold(brand("Veryfront")) + "  " + brand(selected.label));
            console.log();
        }
    }
    return result;
}
