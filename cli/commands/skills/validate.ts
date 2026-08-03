/**
 * Skills validate command, validate a skill directory
 *
 * @module cli/commands/skills/validate
 */

import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { exitProcess, logError, logSuccess, logWarning } from "#cli/utils";
import { createFileSystem } from "veryfront/platform";
import { basename, resolve } from "veryfront/platform/path";
import {
  isValidStrictSkillName,
  parseSkillFrontmatter,
  validateSkillFileMetadata,
} from "veryfront/skill";

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
  const fs = createFileSystem();

  let content: string;
  try {
    content = await fs.readTextFile(`${dir}/SKILL.md`);
  } catch {
    return [{ severity: "error", message: "SKILL.md not found" }];
  }

  try {
    const parsed = await parseSkillFrontmatter(content);
    const directoryName = basename(resolve(dir));
    validateCanonicalFrontmatterName(parsed.frontmatter, directoryName);
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

function validateCanonicalFrontmatterName(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): void {
  if (typeof frontmatter.name !== "string") return;

  const name = frontmatter.name.trim();
  if (!isValidStrictSkillName(name)) {
    return;
  }

  if (name !== directoryName) {
    throw new Error(`Skill name "${name}" does not match directory name "${directoryName}"`);
  }
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
