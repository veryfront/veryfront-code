/**
 * Skills create command, scaffold a new skill
 *
 * @module cli/commands/skills/create
 */

import type { ParsedArgs } from "#cli/shared/types";
import { relative } from "veryfront/platform/path";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { exitProcess, logSuccess, logUsageError } from "#cli/utils";
import { scaffoldProjectFile } from "../../scaffold/engine.ts";

const VALID_SKILL_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export async function createSkill(args: ParsedArgs, projectDir = Deno.cwd()): Promise<void> {
  const name = args._[2] as string | undefined;
  if (!name) {
    logUsageError("Usage: veryfront skills create <name>");
    exitProcess(2);
    return;
  }

  if (!VALID_SKILL_NAME.test(name)) {
    logUsageError(
      `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens (e.g. "my-skill").`,
    );
    exitProcess(2);
    return;
  }

  const result = await scaffoldProjectFile({
    projectDir,
    type: "skill",
    name,
  });

  if (!result.success) throw new Error(result.message);

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope("skills", {
        created: name,
        files: result.files.map((file) => relative(projectDir, file.path)),
      }),
    );
    return;
  }

  logSuccess(`Created skill "${name}" at ./skills/${name}/`);
  console.log(`  Files: skills/${name}/SKILL.md`);
}
