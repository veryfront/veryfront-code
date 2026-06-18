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
          name: s.metadata.name,
          description: s.metadata.description,
          allowedTools: s.metadata.allowedTools,
          directory: s.directory,
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
    const version = skill.metadata.metadata?.version;
    const suffix = version ? ` ${dim(`v${version}`)}` : "";
    console.log(`  ${bold(skill.metadata.name)}${suffix}`);
    console.log(`    ${skill.metadata.description}`);
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
        ...skill.metadata,
        content: skill.skillMd,
        directory: skill.directory,
      }),
    );
    return;
  }

  const version = skill.metadata.metadata?.version;
  const suffix = version ? ` ${dim(`v${version}`)}` : "";
  console.log(`\n  ${bold(skill.metadata.name)}${suffix}`);
  console.log(`  ${skill.metadata.description}\n`);
  if (skill.metadata.allowedTools?.length) {
    console.log(`  ${dim("Allowed tools:")} ${skill.metadata.allowedTools.join(", ")}`);
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
