/**
 * Multi-select interactive UI component
 *
 * Terminal-based multi-select picker with keyboard navigation.
 * Used by install/uninstall commands for tool selection.
 */

import { writeStdout } from "#veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";
import { bold, brand, dim, muted } from "../colors.ts";
import { cursor, screen } from "../ansi.ts";
import { isTTY } from "#cli/utils";

export interface MultiSelectOption<T extends string = string> {
  label: string;
  value: T;
  description: string;
  selected: boolean;
}

export interface MultiSelectConfig {
  title: string;
  subtitle: string;
  hint?: string;
  /** Style for the checkbox when selected. Defaults to brand color. */
  checkboxStyle?: (s: string) => string;
  /** Style for the label when focused. Defaults to identity (no change). */
  focusLabelStyle?: (s: string) => string;
  /** Style for the label when not focused. Defaults to muted. */
  blurLabelStyle?: (s: string) => string;
  /** Style for the description. Defaults to dim. */
  descriptionStyle?: (s: string) => string;
}

const COL_1 = `\x1b[1G`;

function write(s: string): void {
  writeStdout(s);
}

function clearLines(n: number): void {
  for (let i = 0; i < n; i++) write(cursor.up() + screen.clearLine);
  write(COL_1);
}

export async function multiSelect<T extends string>(
  options: MultiSelectOption<T>[],
  config: MultiSelectConfig,
): Promise<T[] | null> {
  const checkboxStyle = config.checkboxStyle ?? brand;
  const focusLabelStyle = config.focusLabelStyle ?? ((s: string) => s);
  const blurLabelStyle = config.blurLabelStyle ?? muted;
  const descriptionStyle = config.descriptionStyle ?? dim;

  const initialSelected = options.filter((o) => o.selected).map((o) => o.value);

  if (!isTTY()) return initialSelected;

  let idx = 0;
  let lines = 0;
  const selected = new Set<T>(initialSelected);

  function draw(): void {
    if (lines > 0) clearLines(lines);

    console.log();
    console.log(
      "  " + bold(config.title) + " " + dim("(space to toggle, enter to confirm)"),
    );
    console.log("  " + dim(config.subtitle));
    console.log();
    lines = 4;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const isCurrent = i === idx;
      const isSelected = selected.has(opt.value);
      const pointer = isCurrent ? brand("❯") : " ";
      const checkbox = isSelected ? checkboxStyle("[✓]") : dim("[ ]");
      const label = isCurrent ? focusLabelStyle(opt.label) : blurLabelStyle(opt.label);
      console.log(`  ${pointer} ${checkbox} ${label.padEnd(24)} ${descriptionStyle(opt.description)}`);
      lines++;
    }

    if (config.hint) {
      console.log();
      console.log("  " + dim("Tip: " + config.hint));
      lines += 2;
    }

    console.log();
    console.log("  " + dim("↑↓ navigate · space toggle · enter confirm · a all · n none"));
    lines += 2;
  }

  write(cursor.hide);
  draw();

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();
  let result: T[] | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const key = dec.decode(value);

      if (key === "\x03" || key === "q" || key === "Q") {
        result = null;
        break;
      }

      if (key === "\r" || key === "\n") {
        result = Array.from(selected);
        break;
      }

      if (key === " ") {
        const val = options[idx]!.value;
        if (selected.has(val)) selected.delete(val);
        else selected.add(val);
        draw();
        continue;
      }

      if (key === "\x1b[A" || key === "k") {
        idx = idx > 0 ? idx - 1 : options.length - 1;
        draw();
        continue;
      }

      if (key === "\x1b[B" || key === "j") {
        idx = idx < options.length - 1 ? idx + 1 : 0;
        draw();
        continue;
      }

      if (key === "a" || key === "A") {
        for (const o of options) selected.add(o.value);
        draw();
        continue;
      }

      if (key === "n" || key === "N") {
        selected.clear();
        draw();
        continue;
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }

  write(cursor.show);
  clearLines(lines);
  return result;
}
