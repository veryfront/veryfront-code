import { brand, dim } from "../colors.js";

export interface Shortcut {
  key: string;
  label: string;
}

export function shortcuts(items: Shortcut[]): string {
  return `  ${items.map(({ key, label }) => `${dim(key)} ${label}`).join("  ")}`;
}

export const DEV_SHORTCUTS: Shortcut[] = [
  { key: "o", label: "open" },
  { key: "c", label: "clear" },
  { key: "q", label: "quit" },
];

export function devShortcuts(): string {
  return shortcuts(DEV_SHORTCUTS);
}

export function shortcutsBlock(items: Shortcut[], header = "Shortcuts"): string {
  const lines = [`  ${dim(`${header}:`)}`, ""];

  for (const { key, label } of items) {
    lines.push(`    ${brand(key)}  ${label}`);
  }

  return lines.join("\n");
}
