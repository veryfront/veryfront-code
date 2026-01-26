import { VERSION } from "../../utils/index.js";
import { bold, brand, dim, muted, shouldUseColor } from "../ui/colors.js";
import { AGENT_FACE } from "../ui/dot-matrix.js";
const RESET = "\x1b[0m";
const LOGO_FALLBACK = "             "; // Logo width ~13 chars
function renderMiniLogo() {
    const useColor = shouldUseColor();
    const litColor = useColor ? "\x1b[38;2;252;143;93m" : "";
    const offColor = useColor ? "\x1b[38;5;240m" : "";
    return AGENT_FACE.map((row) => row
        .map((dot) => `${dot === 1 ? litColor : offColor}${dot === 1 ? "●" : "○"}${RESET}`)
        .join(" "));
}
export function formatHeader() {
    const logoLines = renderMiniLogo();
    const textLines = [
        "",
        `${bold(brand("veryfront"))} ${dim(`v${VERSION}`)}`,
        dim("A Deno-first React framework"),
        "",
        "",
        "",
        "",
    ];
    const maxHeight = Math.max(logoLines.length, textLines.length);
    const output = [""];
    for (let i = 0; i < maxHeight; i++) {
        const logoLine = logoLines[i] ?? LOGO_FALLBACK;
        const textLine = textLines[i] ?? "";
        output.push(`  ${logoLine}   ${textLine}`);
    }
    return output.join("\n");
}
export function formatCommandName(name, paddingLength) {
    return brand(name.padEnd(paddingLength + 2));
}
export function formatDescription(description) {
    return muted(description);
}
export function formatUsage(usage) {
    return `  ${bold("Usage:")} ${usage}`;
}
export function formatOptionFlag(flag, paddingLength) {
    return flag.padEnd(paddingLength + 2);
}
export function formatOption(option, paddingLength) {
    const defaultStr = option.default ? dim(` (default: ${option.default})`) : "";
    return `    ${formatOptionFlag(option.flag, paddingLength)} ${muted(option.description)}${defaultStr}`;
}
export function formatExample(example) {
    return `    ${dim("$")} ${example}`;
}
export function formatSectionHeader(title) {
    return bold(`${title}:`);
}
export function formatCommandHeader(commandName) {
    return `\n  ${bold(brand(`veryfront ${commandName}`))}`;
}
export function formatAsciiLogo() {
    return `
${dim("────────────────────────────────────────")}
  ${bold(brand("veryfront"))}  ${dim("React meta-framework")}
${dim("────────────────────────────────────────")}
`;
}
export function calculateMaxLength(items) {
    return Math.max(...items.map((item) => item.length));
}
export function formatCommandList(commands) {
    const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
    return commands.map((cmd) => `    ${formatCommandName(cmd.name, maxLength)} ${formatDescription(cmd.description)}`);
}
