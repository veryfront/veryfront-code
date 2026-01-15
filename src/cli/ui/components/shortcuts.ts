/**
 * Keyboard Shortcuts Display Component
 *
 * Shows available keyboard shortcuts in a clean format.
 */

import { brand, dim } from "../colors.ts";

export interface Shortcut {
  key: string;
  label: string;
}

/**
 * Format a list of keyboard shortcuts
 */
export function shortcuts(items: Shortcut[]): string {
  const formatted = items.map(({ key, label }) => `${dim(key)} ${label}`);
  return "  " + formatted.join("  ");
}

/**
 * Dev server shortcuts
 */
export const DEV_SHORTCUTS: Shortcut[] = [
  { key: "o", label: "open" },
  { key: "c", label: "clear" },
  { key: "q", label: "quit" },
];

/**
 * Format dev server shortcuts
 */
export function devShortcuts(): string {
  return shortcuts(DEV_SHORTCUTS);
}

/**
 * Shortcuts with header
 */
export function shortcutsBlock(items: Shortcut[], header = "Shortcuts"): string {
  const lines: string[] = [];
  lines.push(`  ${dim(header + ":")}`);
  lines.push("");

  for (const { key, label } of items) {
    lines.push(`    ${brand(key)}  ${label}`);
  }

  return lines.join("\n");
}
