/**
 * Install Command - AI assistant integration installer
 */

import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getCwd, writeStdout } from "#veryfront/platform/compat/process.ts";
import { exists, mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";
import { z } from "zod";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { bold, brand, dim, muted, success, warning } from "../../ui/colors.ts";
import { isTTY } from "../../utils/index.ts";
import { detectAITools, formatDetectionHint } from "./detect.ts";
import { AI_TOOLS, getTemplateContent, getToolById, isValidToolId } from "./registry.ts";
import {
  type AIToolId,
  AIToolIdSchema,
  type InstallOptions,
  InstallOptionsSchema,
  type MultiSelectOption,
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

async function multiSelect(
  options: MultiSelectOption[],
  hint?: string,
): Promise<AIToolId[] | null> {
  if (!isTTY()) return options.filter((o) => o.selected).map((o) => o.value as AIToolId);

  let idx = 0;
  let lines = 0;
  const selected = new Set<AIToolId>(
    options.filter((o) => o.selected).map((o) => o.value as AIToolId),
  );

  function draw(): void {
    if (lines > 0) clearLines(lines);

    console.log();
    console.log(
      "  " + bold("Select AI Coding Tools") + " " + dim("(space to toggle, enter to confirm)"),
    );
    console.log("  " + dim("Install integrations for your AI assistants."));
    console.log();
    lines = 4;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const isCurrent = i === idx;
      const isSelected = selected.has(opt.value as AIToolId);
      const pointer = isCurrent ? brand("❯") : " ";
      const checkbox = isSelected ? brand("[✓]") : dim("[ ]");
      const label = isCurrent ? opt.label : muted(opt.label);
      console.log(`  ${pointer} ${checkbox} ${label.padEnd(24)} ${dim(opt.description)}`);
      lines++;
    }

    if (hint) {
      console.log();
      console.log("  " + dim("Tip: " + hint));
      lines += 2;
    }

    console.log();
    console.log("  " + dim("↑↓ navigate · space toggle · enter confirm · a all · n none"));
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
        const value = opt.value as AIToolId;
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
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
        for (const o of options) selected.add(o.value as AIToolId);
        draw();
        continue;
      }

      if (key === "n" || key === "N") {
        selected.clear();
        draw();
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

export async function installTargets(
  targets: AIToolId[],
  options: Pick<InstallOptions, "cwd" | "force" | "global">,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<void> {
  z.array(AIToolIdSchema).min(1).parse(targets);

  const cwd = options.cwd ?? getCwd();
  const homeDir = env.homeDir!;

  console.log();
  console.log("  " + bold("Installing AI integrations..."));
  console.log();

  for (const toolId of targets) {
    const tool = getToolById(toolId);
    const content = await getTemplateContent(toolId);
    const dest = options.global ? join(homeDir, tool.file) : join(cwd, tool.file);

    await mkdir(dirname(dest), { recursive: true });

    if (!options.force && (await exists(dest))) {
      console.log(`  ${warning("!")} ${tool.file} ${muted("exists (use --force to overwrite)")}`);
      continue;
    }

    await writeTextFile(dest, content);
    console.log(`  ${success("✓")} ${tool.file}`);
  }

  console.log();
  console.log("  " + success("Your AI assistants now know Veryfront!"));
  console.log("  " + dim('Try: "Add a contact form with email validation"'));
  console.log();
}

export async function installCommand(options: InstallOptions = {}): Promise<void> {
  const validated = InstallOptionsSchema.parse(options);
  const cwd = validated.cwd ?? getCwd();

  if (validated.target) {
    await installTargets(parseTargetFlag(validated.target), { ...validated, cwd });
    return;
  }

  const detected = await detectAITools({ cwd });
  const hint = formatDetectionHint(detected);

  const selectOptions: MultiSelectOption[] = AI_TOOLS.map((tool) => ({
    label: tool.label,
    value: tool.id,
    description: tool.description,
    selected: detected.includes(tool.id),
  }));

  const selected = await multiSelect(selectOptions, hint);
  if (!selected?.length) {
    console.log();
    console.log("  " + muted("No tools selected."));
    console.log();
    return;
  }

  await installTargets(selected, { ...validated, cwd });
}
