import { writeStdout } from "../../platform/compat/process.js";
import { getStdinReader, setRawMode } from "../../platform/compat/stdin.js";
const ESC = "\x1b";
const rgb = (r, g, b) => (t) => `${ESC}[38;2;${r};${g};${b}m${t}${ESC}[0m`;
const BRAND = rgb(0, 163, 244);
const GREEN = rgb(34, 197, 94);
const DIM = rgb(113, 113, 122);
const BOLD = (t) => `${ESC}[1m${t}${ESC}[0m`;
const TEMPLATES = [
    { id: "ai", label: "AI Agent" },
    { id: "app", label: "Full App" },
    { id: "blog", label: "Blog" },
    { id: "docs", label: "Documentation" },
    { id: "minimal", label: "Minimal" },
];
const INTEGRATIONS = [
    { id: "gmail", label: "Gmail" },
    { id: "slack", label: "Slack" },
    { id: "notion", label: "Notion" },
    { id: "github", label: "GitHub" },
    { id: "calendar", label: "Calendar" },
    { id: "drive", label: "Google Drive" },
    { id: "jira", label: "Jira" },
    { id: "linear", label: "Linear" },
];
const hide = `${ESC}[?25l`;
const show = `${ESC}[?25h`;
const up = (n = 1) => `${ESC}[${n}A`;
const clearLine = `${ESC}[2K`;
const col1 = `${ESC}[1G`;
function write(s) {
    writeStdout(s);
}
function clear(n) {
    for (let i = 0; i < n; i++)
        write(up() + clearLine);
    write(col1);
}
function isEnter(key) {
    return key === "\r" || key === "\n";
}
function isUp(key) {
    return key === "\x1b[A" || key === "k";
}
function isDown(key) {
    return key === "\x1b[B" || key === "j";
}
async function select(label, options) {
    let idx = 0;
    let lines = 0;
    function draw() {
        if (lines > 0)
            clear(lines);
        console.log(DIM("?") + " " + BOLD(label));
        lines = 1;
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (!opt)
                continue;
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
            if (done)
                break;
            const key = dec.decode(value);
            if (key === "\x03") {
                reader.releaseLock();
                setRawMode(false);
                write(show);
                clear(lines);
                return null;
            }
            if (isEnter(key))
                break;
            if (isUp(key)) {
                idx = idx > 0 ? idx - 1 : options.length - 1;
                draw();
                continue;
            }
            if (isDown(key)) {
                idx = idx < options.length - 1 ? idx + 1 : 0;
                draw();
            }
        }
    }
    finally {
        reader.releaseLock();
        setRawMode(false);
    }
    write(show);
    clear(lines);
    const selected = options[idx];
    console.log(DIM("?") + " " + BOLD(label) + " " + BRAND(selected?.label ?? ""));
    return selected?.id ?? null;
}
async function multiSelect(label, options) {
    let idx = 0;
    const picked = new Set();
    let lines = 0;
    function draw() {
        if (lines > 0)
            clear(lines);
        console.log(DIM("?") + " " + BOLD(label) + DIM(" (space to toggle, enter to confirm)"));
        lines = 1;
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (!opt)
                continue;
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
            if (done)
                break;
            const key = dec.decode(value);
            if (key === "\x03") {
                reader.releaseLock();
                setRawMode(false);
                write(show);
                clear(lines);
                return null;
            }
            if (isEnter(key))
                break;
            if (key === " ") {
                const opt = options[idx];
                if (opt) {
                    if (picked.has(opt.id))
                        picked.delete(opt.id);
                    else
                        picked.add(opt.id);
                    draw();
                }
                continue;
            }
            if (isUp(key)) {
                idx = idx > 0 ? idx - 1 : options.length - 1;
                draw();
                continue;
            }
            if (isDown(key)) {
                idx = idx < options.length - 1 ? idx + 1 : 0;
                draw();
                continue;
            }
            if (key === "a") {
                if (picked.size === options.length)
                    picked.clear();
                else
                    options.forEach((o) => picked.add(o.id));
                draw();
            }
        }
    }
    finally {
        reader.releaseLock();
        setRawMode(false);
    }
    write(show);
    clear(lines);
    const labels = options.filter((o) => picked.has(o.id)).map((o) => o.label);
    console.log(DIM("?") + " " + BOLD(label) + " " + (labels.length ? BRAND(labels.join(", ")) : DIM("none")));
    return Array.from(picked);
}
export async function runNewTui(projectName, _userEmail) {
    console.log();
    console.log("  Creating " + BRAND(projectName));
    console.log();
    const template = await select("Template", TEMPLATES);
    if (!template)
        return { template: "ai", integrations: [], cancelled: true };
    console.log();
    const integrations = await multiSelect("Integrations", INTEGRATIONS);
    if (!integrations)
        return { template, integrations: [], cancelled: true };
    console.log();
    return { template, integrations, cancelled: false };
}
