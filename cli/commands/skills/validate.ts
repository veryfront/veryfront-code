/**
 * Skills validate command — validate a skill directory
 *
 * @module cli/commands/skills/validate
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { parseSkillJson } from "../../skills/types.ts";
import { COMMANDS } from "../../help/command-definitions.ts";
import { logError, logSuccess } from "#cli/utils";

interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export async function validateSkill(args: ParsedArgs): Promise<void> {
  const dir = (args._[2] as string | undefined) ?? ".";
  const issues: ValidationIssue[] = [];

  // Check skill.json exists and parses
  let manifestRaw: string;
  try {
    manifestRaw = await Deno.readTextFile(`${dir}/skill.json`);
  } catch {
    issues.push({ severity: "error", message: "skill.json not found" });
    return outputResults("skills", dir, issues, args);
  }

  let parsed: ReturnType<typeof parseSkillJson>;
  try {
    parsed = parseSkillJson(JSON.parse(manifestRaw));
  } catch {
    issues.push({ severity: "error", message: "skill.json is not valid JSON" });
    return outputResults("skills", dir, issues, args);
  }

  if (!parsed.success) {
    issues.push({
      severity: "error",
      message: `skill.json schema error: ${parsed.error}`,
    });
    return outputResults("skills", dir, issues, args);
  }

  // Check SKILL.md exists
  try {
    const content = await Deno.readTextFile(`${dir}/SKILL.md`);
    if (!content.trim()) {
      issues.push({ severity: "warning", message: "SKILL.md is empty" });
    }
  } catch {
    issues.push({ severity: "error", message: "SKILL.md not found" });
  }

  // Check required CLI commands exist
  const cliReqs = parsed.data.requires?.cli ?? [];
  for (const cmd of cliReqs) {
    if (!COMMANDS[cmd]) {
      issues.push({
        severity: "warning",
        message: `Required CLI command "${cmd}" not found in registry`,
      });
    }
  }

  return outputResults("skills", dir, issues, args);
}

async function outputResults(
  command: string,
  dir: string,
  issues: ValidationIssue[],
  _args: ParsedArgs,
): Promise<void> {
  const hasErrors = issues.some((i) => i.severity === "error");

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope(command, {
        directory: dir,
        valid: !hasErrors,
        issues,
      }),
    );
    if (hasErrors) Deno.exit(1);
    return;
  }

  if (issues.length === 0) {
    logSuccess(`Skill at "${dir}" is valid`);
    return;
  }

  for (const issue of issues) {
    if (issue.severity === "error") {
      logError(issue.message);
    } else {
      console.log(`  ! ${issue.message}`);
    }
  }

  if (hasErrors) Deno.exit(1);
}
