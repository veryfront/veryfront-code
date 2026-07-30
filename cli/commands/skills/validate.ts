/**
 * Skills validate command, validate a skill directory
 *
 * @module cli/commands/skills/validate
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { exitProcess, logError, logSuccess, logWarning } from "#cli/utils";
import { basename, resolve } from "veryfront/platform/path";
import { isNotFoundError } from "veryfront/fs";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "veryfront/skill";
import { readSkillDocument } from "../../skills/read-skill-document.ts";
import { assertSkillDirectoryIdentity } from "../../skills/validation.ts";

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
    const directoryName = basename(resolve(dir));
    assertSkillDirectoryIdentity(parsed.frontmatter, directoryName);
    validateSkillFileMetadata(parsed.frontmatter, directoryName);
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
    if (hasErrors) exitProcess(1);
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
      logWarning(issue.message);
    }
  }

  if (hasErrors) exitProcess(1);
}
