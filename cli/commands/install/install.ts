/**
 * Install Command - AI assistant integration installer
 */

import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getCwd } from "#veryfront/platform/compat/process.ts";
import { exists, mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { z } from "zod";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { bold, dim, type MultiSelectOption, multiSelect, muted, success, warning } from "#cli/ui";
import { detectAITools, formatDetectionHint } from "./detect.ts";
import { AI_TOOLS, getTemplateContent, getToolById, isValidToolId } from "./registry.ts";
import {
  type AIToolId,
  AIToolIdSchema,
  type InstallOptions,
  InstallOptionsSchema,
} from "./types.ts";

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
  env: EnvironmentConfig = getEnvironmentConfig(),
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

  const selectOptions: MultiSelectOption<AIToolId>[] = AI_TOOLS.map((tool) => ({
    label: tool.label,
    value: tool.id,
    description: tool.description,
    selected: detected.includes(tool.id),
  }));

  const selected = await multiSelect(selectOptions, {
    title: "Select AI Coding Tools",
    subtitle: "Install integrations for your AI assistants.",
    hint,
  });
  if (!selected?.length) {
    console.log();
    console.log("  " + muted("No tools selected."));
    console.log();
    return;
  }

  await installTargets(selected as AIToolId[], { ...validated, cwd });
}
