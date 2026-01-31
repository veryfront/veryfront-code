/**
 * Uninstall Command - Remove AI assistant integrations
 */

import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getCwd, writeStdout } from "#veryfront/platform/compat/process.ts";
import { exists, readDir, remove } from "#veryfront/platform/compat/fs.ts";
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";
import { z } from "zod";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
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
  writeStdout(s);
}

function clearLines(n: number): void {
  for (let i = 0; i < n; i++) write(moveUp() + CLEAR_LINE);
  write(COL_1);
}

async function multiSelect(options: MultiSelectOption[]): Promise<AIToolId[] | null> {
  const initialSelected = options
    .filter((o) => o.selected)
    .map((o) => o.value)
    .filter((v): v is AIToolId => isValidToolId(v));

  if (!isTTY()) return initialSelected;

  let idx = 0;
  let lines = 0;
  const selected = new Set<AIToolId>(initialSelected);

  function draw(): void {
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
      const isSelected = isValidToolId(opt.value) && selected.has(opt.value);
      const pointer = isCurrent ? brand("❯") : " ";
      const checkbox = isSelected ? success("[✓]") : dim("[ ]");
      const label = isCurrent ? brand(opt.label) : opt.label;

      console.log(`  ${pointer} ${checkbox} ${label.padEnd(24)} ${muted(opt.description)}`);
      lines++;
    }

    console.log();
    console.log("  " + muted("↑↓ navigate · space toggle · enter confirm · a all · n none"));
    lines += 2;
  }

  write(HIDE_CURSOR);
  draw();

  setRawMode(true);
  const reader = getStdinReader();
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
        result = Array.from(selected);
        break;
      }

      if (key === " ") {
        const opt = options[idx]!;
        if (isValidToolId(opt.value)) {
          if (selected.has(opt.value)) selected.delete(opt.value);
          else selected.add(opt.value);
        }
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
        for (const o of options) {
          if (isValidToolId(o.value)) selected.add(o.value);
        }
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
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<AIToolId[]> {
  const cwd = options.cwd ?? getCwd();
  const homeDir = env.homeDir!;
  const installed: AIToolId[] = [];

  for (const tool of AI_TOOLS) {
    const path = options.global ? join(homeDir, tool.file) : join(cwd, tool.file);
    if (await exists(path)) installed.push(tool.id);
  }

  return installed;
}

async function isDirEmpty(path: string): Promise<boolean> {
  for await (const _entry of readDir(path)) return false;
  return true;
}

export async function uninstallTargets(
  targets: AIToolId[],
  options: Pick<UninstallOptions, "cwd" | "global">,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<void> {
  z.array(AIToolIdSchema).min(1).parse(targets);

  const cwd = options.cwd ?? getCwd();
  const homeDir = env.homeDir!;

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

    await remove(dest);

    // Try to remove empty parent directories (but not cwd itself)
    try {
      const parent = dirname(dest);
      const baseDir = options.global ? homeDir : cwd;

      if (parent !== baseDir && (await isDirEmpty(parent))) {
        // Node.js requires recursive: true to remove directories
        await remove(parent, { recursive: true });
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

export async function uninstallCommand(options: UninstallOptions = {}): Promise<void> {
  const validated = UninstallOptionsSchema.parse(options);
  const cwd = validated.cwd ?? getCwd();

  if (validated.target) {
    await uninstallTargets(parseTargetFlag(validated.target), { ...validated, cwd });
    return;
  }

  const installed = await findInstalledTools({ cwd, global: validated.global });

  if (installed.length === 0) {
    console.log();
    console.log("  " + muted("No AI tool files found."));
    console.log();
    return;
  }

  const selectOptions: MultiSelectOption[] = AI_TOOLS.filter((tool) => installed.includes(tool.id))
    .map(
      (tool) => ({
        label: tool.label,
        value: tool.id,
        description: tool.file,
        selected: true,
      }),
    );

  const selected = await multiSelect(selectOptions);
  if (!selected?.length) {
    console.log();
    console.log("  " + muted("No files selected."));
    console.log();
    return;
  }

  await uninstallTargets(selected, { ...validated, cwd });
}
