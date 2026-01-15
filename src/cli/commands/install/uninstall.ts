/**
 * Uninstall Command - Remove AI assistant integrations
 */

import { dirname, join } from "@veryfront/platform/compat/path/index.ts";
import { cwd as getCwd } from "@veryfront/platform/compat/process.ts";
import { z } from "zod";
import { bold, brand, dim, muted, success, warning } from "../../ui/colors.ts";
import { isTTY } from "../../utils/index.ts";
import { AI_TOOLS, getToolById, isValidToolId } from "./registry.ts";
import {
  type AIToolId,
  AIToolIdSchema,
  type MultiSelectOption,
  type UninstallOptions,
  UninstallOptionsSchema,
} from "./types.ts";

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;
const COL_1 = `${ESC}[1G`;
const moveUp = (n = 1) => `${ESC}[${n}A`;

function write(s: string): void {
  Deno.stdout.writeSync(new TextEncoder().encode(s));
}

function clearLines(n: number): void {
  for (let i = 0; i < n; i++) write(moveUp() + CLEAR_LINE);
  write(COL_1);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function multiSelect(
  options: MultiSelectOption[],
): Promise<AIToolId[] | null> {
  if (!isTTY()) {
    return options.filter((o) => o.selected).map((o) => o.value) as AIToolId[];
  }

  let idx = 0;
  let lines = 0;
  const selected = new Set(
    options.filter((o) => o.selected).map((o) => o.value),
  );

  function draw() {
    if (lines > 0) clearLines(lines);

    console.log();
    console.log(
      "  " + bold(brand("Remove AI Tool Files")) + " " +
        muted("(space to toggle, enter to confirm)"),
    );
    console.log("  " + muted("Select files to remove."));
    console.log();
    lines = 4;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const isCurrent = i === idx;
      const isSelected = selected.has(opt.value);
      const pointer = isCurrent ? brand("❯") : " ";
      const checkbox = isSelected ? success("[✓]") : dim("[ ]");
      const label = isCurrent ? brand(opt.label) : opt.label;
      console.log(
        `  ${pointer} ${checkbox} ${label.padEnd(24)} ${muted(opt.description)}`,
      );
      lines++;
    }

    console.log();
    console.log(
      "  " + muted("↑↓ navigate · space toggle · enter confirm · a all · n none"),
    );
    lines += 2;
  }

  write(HIDE_CURSOR);
  draw();

  Deno.stdin.setRaw(true);
  const reader = Deno.stdin.readable.getReader();
  const dec = new TextDecoder();
  let result: AIToolId[] | null = null;

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
        result = Array.from(selected) as AIToolId[];
        break;
      }
      if (key === " ") {
        const opt = options[idx]!;
        selected.has(opt.value) ? selected.delete(opt.value) : selected.add(opt.value);
        draw();
      }
      if (key === "\x1b[A" || key === "k") {
        idx = idx > 0 ? idx - 1 : options.length - 1;
        draw();
      }
      if (key === "\x1b[B" || key === "j") {
        idx = idx < options.length - 1 ? idx + 1 : 0;
        draw();
      }
      if (key === "a" || key === "A") {
        options.forEach((o) => selected.add(o.value));
        draw();
      }
      if (key === "n" || key === "N") {
        selected.clear();
        draw();
      }
    }
  } finally {
    reader.releaseLock();
    Deno.stdin.setRaw(false);
  }

  write(SHOW_CURSOR);
  clearLines(lines);
  return result;
}

const TargetFlagSchema = z
  .string()
  .transform((val) => {
    if (val === "all") return AI_TOOLS.map((t) => t.id);
    return val
      .split(",")
      .map((t) => t.trim())
      .filter(isValidToolId);
  })
  .refine((arr) => arr.length > 0, { message: "No valid targets specified" });

export function parseTargetFlag(target: string): AIToolId[] {
  return TargetFlagSchema.parse(target);
}

export async function findInstalledTools(
  options: Pick<UninstallOptions, "cwd" | "global">,
): Promise<AIToolId[]> {
  const cwd = options.cwd ?? getCwd();
  const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
  const installed: AIToolId[] = [];

  for (const tool of AI_TOOLS) {
    const path = options.global ? join(homeDir, tool.file) : join(cwd, tool.file);
    if (await exists(path)) {
      installed.push(tool.id);
    }
  }

  return installed;
}

export async function uninstallTargets(
  targets: AIToolId[],
  options: Pick<UninstallOptions, "cwd" | "global">,
): Promise<void> {
  z.array(AIToolIdSchema).min(1).parse(targets);

  const cwd = options.cwd ?? getCwd();
  const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;

  console.log();
  console.log("  " + bold("Removing AI integrations..."));
  console.log();

  for (const toolId of targets) {
    const tool = getToolById(toolId);
    const dest = options.global ? join(homeDir, tool.file) : join(cwd, tool.file);

    if (!(await exists(dest))) {
      console.log(`  ${warning("!")} ${tool.file} ${muted("not found")}`);
      continue;
    }

    await Deno.remove(dest);

    // Try to remove empty parent directories (but not cwd itself)
    try {
      const parent = dirname(dest);
      const baseDir = options.global ? (Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!) : cwd;
      // Only remove parent if it's not the base directory
      if (parent !== baseDir) {
        const entries = [];
        for await (const entry of Deno.readDir(parent)) {
          entries.push(entry);
        }
        if (entries.length === 0) {
          await Deno.remove(parent);
        }
      }
    } catch {
      // Ignore - parent dir might not be empty or might not exist
    }

    console.log(`  ${success("✓")} ${tool.file} ${muted("removed")}`);
  }

  console.log();
  console.log("  " + success("AI integrations removed."));
  console.log();
}

export async function uninstallCommand(
  options: UninstallOptions = {},
): Promise<void> {
  const validated = UninstallOptionsSchema.parse(options);
  const cwd = validated.cwd ?? getCwd();

  if (validated.target) {
    const targets = parseTargetFlag(validated.target);
    await uninstallTargets(targets, { ...validated, cwd });
    return;
  }

  const installed = await findInstalledTools({ cwd, global: validated.global });

  if (installed.length === 0) {
    console.log();
    console.log("  " + muted("No AI tool files found."));
    console.log();
    return;
  }

  const selectOptions: MultiSelectOption[] = AI_TOOLS
    .filter((tool) => installed.includes(tool.id))
    .map((tool) => ({
      label: tool.label,
      value: tool.id,
      description: tool.file,
      selected: true,
    }));

  const selected = await multiSelect(selectOptions);
  if (!selected || selected.length === 0) {
    console.log();
    console.log("  " + muted("No files selected."));
    console.log();
    return;
  }

  await uninstallTargets(selected, { ...validated, cwd });
}
