import { brand, dim } from "../colors.js";
export function shortcuts(items) {
    return `  ${items.map(({ key, label }) => `${dim(key)} ${label}`).join("  ")}`;
}
export const DEV_SHORTCUTS = [
    { key: "o", label: "open" },
    { key: "c", label: "clear" },
    { key: "q", label: "quit" },
];
export function devShortcuts() {
    return shortcuts(DEV_SHORTCUTS);
}
export function shortcutsBlock(items, header = "Shortcuts") {
    const lines = [`  ${dim(`${header}:`)}`, ""];
    for (const { key, label } of items) {
        lines.push(`    ${brand(key)}  ${label}`);
    }
    return lines.join("\n");
}
