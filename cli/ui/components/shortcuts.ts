import { brand, dim } from "../colors.ts";

export interface Shortcut {
  key: string;
  label: string;
}

export function shortcuts(items: Shortcut[]): string {
  return `  ${items.map(({ key, label }) => `${brand(key)} ${label}`).join("  ")}`;
}

export const DEV_SHORTCUTS: Shortcut[] = [
  { key: "?", label: "shortcuts" },
  { key: "o", label: "open" },
  { key: "l", label: "verbose logs" },
  { key: "s", label: "projects" },
  { key: "p", label: "pull" },
  { key: "u", label: "push" },
  { key: "a", label: "account" },
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
