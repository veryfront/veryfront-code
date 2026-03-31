import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { getSkillInfo, listSkills } from "./command.ts";
import { bold, dim } from "../../ui/colors.ts";

export async function handleSkillsCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args._[1] as string | undefined;

  switch (subcommand) {
    case "info":
      return await handleSkillInfo(args);
    case "create":
      return await handleSkillCreate(args);
    case "validate":
      return await handleSkillValidate(args);
    case "list":
    default:
      return await handleSkillList();
  }
}

async function handleSkillList(): Promise<void> {
  const skills = await listSkills();

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope(
        "skills",
        skills.map((s) => ({
          name: s.manifest.name,
          version: s.manifest.version,
          description: s.manifest.description,
          requires: s.manifest.requires,
        })),
      ),
    );
    return;
  }

  if (skills.length === 0) {
    console.log(`  ${dim("No skills found.")}`);
    console.log(
      `  ${dim("Skills are located in cli/mcp/skills/")}`,
    );
    return;
  }

  console.log(`\n  ${bold("Available Skills")}\n`);
  for (const skill of skills) {
    console.log(
      `  ${bold(skill.manifest.name)} ${dim(`v${skill.manifest.version}`)}`,
    );
    console.log(`    ${skill.manifest.description}`);
  }
  console.log();
}

async function handleSkillInfo(args: ParsedArgs): Promise<void> {
  const name = args._[2] as string | undefined;
  if (!name) {
    console.error("Usage: veryfront skills info <name>");
    Deno.exit(1);
  }

  const skill = await getSkillInfo(name);
  if (!skill) {
    console.error(`Skill not found: ${name}`);
    Deno.exit(1);
  }

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope("skills", {
        ...skill.manifest,
        content: skill.skillMd,
        directory: skill.directory,
      }),
    );
    return;
  }

  console.log(`\n  ${bold(skill.manifest.name)} ${dim(`v${skill.manifest.version}`)}`);
  console.log(`  ${skill.manifest.description}\n`);
  if (skill.manifest.requires) {
    if (skill.manifest.requires.cli?.length) {
      console.log(`  ${dim("CLI:")} ${skill.manifest.requires.cli.join(", ")}`);
    }
    if (skill.manifest.requires.mcp?.length) {
      console.log(`  ${dim("MCP:")} ${skill.manifest.requires.mcp.join(", ")}`);
    }
  }
  if (skill.skillMd) {
    console.log(`\n${skill.skillMd}`);
  }
}

async function handleSkillCreate(args: ParsedArgs): Promise<void> {
  const { createSkill } = await import("./create.ts");
  await createSkill(args);
}

async function handleSkillValidate(args: ParsedArgs): Promise<void> {
  const { validateSkill } = await import("./validate.ts");
  await validateSkill(args);
}
