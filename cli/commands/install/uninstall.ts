/**
 * Uninstall Command - Remove AI assistant integrations
 */

import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd as getCwd } from "#veryfront/platform/compat/process.ts";
import { exists, readDir, remove } from "#veryfront/platform/compat/fs.ts";
import { z } from "zod";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { bold, brand, type MultiSelectOption, multiSelect, muted, success, warning } from "#cli/ui";
import { AI_TOOLS, getToolById } from "./registry.ts";
import { parseTargetFlag } from "./install.ts";
import {
  type AIToolId,
  AIToolIdSchema,
  type UninstallOptions,
  UninstallOptionsSchema,
} from "./types.ts";

export { parseTargetFlag };

export async function findInstalledTools(
  options: Pick<UninstallOptions, "cwd" | "global">,
  env: EnvironmentConfig = getEnvironmentConfig(),
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
  env: EnvironmentConfig = getEnvironmentConfig(),
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

  const selectOptions: MultiSelectOption<AIToolId>[] = AI_TOOLS.filter((tool) =>
    installed.includes(tool.id)
  )
    .map(
      (tool) => ({
        label: tool.label,
        value: tool.id,
        description: tool.file,
        selected: true,
      }),
    );

  const selected = await multiSelect(selectOptions, {
    title: brand("Remove AI Tool Files"),
    subtitle: "Select files to remove.",
    checkboxStyle: success,
    focusLabelStyle: brand,
    blurLabelStyle: (s: string) => s,
    descriptionStyle: muted,
  });
  if (!selected?.length) {
    console.log();
    console.log("  " + muted("No files selected."));
    console.log();
    return;
  }

  await uninstallTargets(selected as AIToolId[], { ...validated, cwd });
}
