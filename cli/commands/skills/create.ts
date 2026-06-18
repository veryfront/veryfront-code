/**
 * Skills create command, scaffold a new skill
 *
 * @module cli/commands/skills/create
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { logSuccess } from "#cli/utils";
import { scaffoldProjectFile } from "../../scaffold/engine.ts";

const VALID_SKILL_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export async function createSkill(args: ParsedArgs): Promise<void> {
  const name = args._[2] as string | undefined;
  if (!name) {
    console.error("Usage: veryfront skills create <name>");
    Deno.exit(1);
  }

  if (!VALID_SKILL_NAME.test(name)) {
    console.error(
      `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens (e.g. "my-skill").`,
    );
    Deno.exit(1);
  }

  const result = await scaffoldProjectFile({
    projectDir: Deno.cwd(),
    type: "skill",
    name,
  });

  if (!result.success) throw new Error(result.message);

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope("skills", {
        created: name,
        files: result.files.map((file) => file.path),
      }),
    );
    return;
  }

  logSuccess(`Created skill "${name}" at ./skills/${name}/`);
  console.log(`  Files: skills/${name}/SKILL.md`);
}
