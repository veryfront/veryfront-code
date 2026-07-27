/**
 * Skills validate command, validate a skill directory
 *
 * @module cli/commands/skills/validate
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { logError, logSuccess } from "#cli/utils";
import { basename } from "#std/path.ts";
import { isNotFoundError } from "veryfront/fs";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "veryfront/skill";
import { readSkillDocument } from "../../skills/read-skill-document.ts";

interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export async function validateSkill(args: ParsedArgs): Promise<void> {
  const dir = (args._[2] as string | undefined) ?? ".";
  const issues = await validateSkillDirectory(dir);

  return outputResults(dir, issues);
}

export async function validateSkillDirectory(dir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  let content: string;
  try {
    content = await readSkillDocument(`${dir}/SKILL.md`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{
      severity: "error",
      message: isNotFoundError(error) ? "SKILL.md not found" : message,
    }];
  }

  try {
    const parsed = await parseSkillFileFrontmatter(content);
    validateSkillFileMetadata(parsed.frontmatter, basename(dir));
    if (!parsed.body.trim()) {
      issues.push({ severity: "warning", message: "SKILL.md body is empty" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({ severity: "error", message });
  }

  return issues;
}

async function outputResults(
  dir: string,
  issues: ValidationIssue[],
): Promise<void> {
  const hasErrors = issues.some((i) => i.severity === "error");

  if (isJsonMode()) {
    await outputJson(
      createSuccessEnvelope("skills", {
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
