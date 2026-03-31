/**
 * Skills create command — scaffold a new skill
 *
 * @module cli/commands/skills/create
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { logSuccess } from "#cli/utils";
import { createFileSystem } from "veryfront/platform";

const VALID_SKILL_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const SKILL_JSON_TEMPLATE = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "1.0.0",
      description: `${name} skill`,
      requires: {
        cli: [],
        mcp: [],
      },
      inputs: {},
    },
    null,
    2,
  );

const SKILL_MD_TEMPLATE = (name: string) =>
  `# ${name}

## Overview

Describe what this skill does.

## Steps

1. **Step 1** — Description
   \`\`\`bash
   veryfront <command> --json
   \`\`\`

2. **Step 2** — Description

## Error Recovery

- If step 1 fails: ...
- If step 2 fails: ...
`;

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

  const fs = createFileSystem();
  const dir = name;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeTextFile(`${dir}/skill.json`, SKILL_JSON_TEMPLATE(name));
  await fs.writeTextFile(`${dir}/SKILL.md`, SKILL_MD_TEMPLATE(name));

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope("skills", {
        created: name,
        files: [`${dir}/skill.json`, `${dir}/SKILL.md`],
      }),
    );
    return;
  }

  logSuccess(`Created skill "${name}" at ./${dir}/`);
  console.log(`  Files: skill.json, SKILL.md`);
}
