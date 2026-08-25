#!/usr/bin/env -S deno run --allow-read --allow-run=git --allow-env=TEST_SEMANTIC_AUDIT_BASE_REF
import { parseArgs } from "#std/flags";
import {
  collectSemanticAuditCandidates,
  compareSemanticDispositionBaseline,
  parseSemanticDispositionBaselineSource,
  type SemanticDispositionBaseline,
} from "../test/test-semantic-audit.ts";
import {
  TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
} from "../test/test-semantic-audit-migration.ts";

const MIGRATION_FILE_PATH = "scripts/test/test-semantic-audit-migration.ts";

export function formatSemanticAuditFailure(
  errors: readonly string[],
  candidateCount: number,
): string {
  const staleOnly = errors.length > 0 &&
    errors.every((error) =>
      error.startsWith("stale semantic disposition must be removed:")
    );
  if (staleOnly) {
    return [
      `Semantic unit-boundary debt shrank to ${candidateCount} file(s).`,
      ...errors.map((error) => `  ${error}`),
      "",
      `Regenerate ${MIGRATION_FILE_PATH} to remove the stale dispositions.`,
    ].join("\n");
  }
  return [
    "Semantic unit-boundary audit failed:",
    ...errors.map((error) => `  ${error}`),
    "",
    `Do not grow ${MIGRATION_FILE_PATH}; move the test to integration/e2e or make the unit hermetic.`,
  ].join("\n");
}

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    boolean: ["json"],
    default: { json: false },
  });
  const result = await collectSemanticAuditCandidates({
    root: ".",
    dispositions: TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
  });
  let baselineErrors: string[];
  try {
    baselineErrors = compareSemanticDispositionBaseline(
      TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
      await resolveSemanticBaselineFromGit(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    baselineErrors = [
      `semantic audit baseline resolution failed: ${message}`,
    ];
  }
  const errors = [...result.errors, ...baselineErrors];

  if (flags.json) {
    console.log(JSON.stringify(
      {
        consideredFiles: result.consideredFiles,
        candidates: result.candidates,
        errors,
      },
      null,
      2,
    ));
    if (errors.length > 0) Deno.exit(1);
    return;
  }

  if (errors.length > 0) {
    console.error(formatSemanticAuditFailure(errors, result.candidates.length));
    Deno.exit(1);
  }

  console.log(
    `Semantic unit-boundary audit ok: ${result.consideredFiles} unit executable(s) considered; ` +
      `${result.candidates.length} effect-bearing file(s) disposed.`,
  );
}

export interface SemanticBaselineFromGitOptions {
  readonly configuredRef?: string;
  readonly git?: SemanticAuditGitRunner;
}

/**
 * Reads the migration inventory out of the baseline commit.
 *
 * The configured ref is routed through {@link resolveSemanticAuditBaselineRef}
 * before any `cat-file` or `show` sees it. Reading the configured ref straight
 * out of the environment here is the original defect: it bypassed the
 * normalizer entirely, so a ref that is not an ancestor of HEAD made the two
 * audit arms read different trees.
 */
export async function resolveSemanticBaselineFromGit(
  options: SemanticBaselineFromGitOptions = {},
): Promise<SemanticDispositionBaseline> {
  const git = options.git ?? runGit;
  const ref = await resolveSemanticAuditBaselineRef({
    configuredRef: options.configuredRef ??
      Deno.env.get("TEST_SEMANTIC_AUDIT_BASE_REF") ?? undefined,
    git,
  });
  const commitCheck = await git(["cat-file", "-e", `${ref}^{commit}`]);
  if (!commitCheck.ok) {
    return {
      kind: "malformed",
      ref,
      reason: `base ref is not a commit: ${commitCheck.stderr}`,
    };
  }
  const fileCheck = await git([
    "cat-file",
    "-e",
    `${ref}:${MIGRATION_FILE_PATH}`,
  ]);
  if (!fileCheck.ok) return { kind: "missing", ref };
  const source = await git(["show", `${ref}:${MIGRATION_FILE_PATH}`]);
  if (!source.ok) {
    return {
      kind: "malformed",
      ref,
      reason: `base semantic inventory could not be read: ${source.stderr}`,
    };
  }
  return parseSemanticDispositionBaselineSource(source.stdout, ref);
}

export type SemanticAuditGitRunner = (
  args: readonly string[],
) => Promise<GitResult>;

export interface SemanticAuditBaselineRefOptions {
  readonly configuredRef?: string;
  readonly git?: SemanticAuditGitRunner;
}

/**
 * Resolves the commit the baseline arm of the semantic audit reads.
 *
 * Both the configured ref and the local fallback are normalized through
 * `git merge-base HEAD <ref>` so the baseline is an ancestor of the tree the
 * candidate arm scans. Without that normalization a configured
 * `TEST_SEMANTIC_AUDIT_BASE_REF` pointing at a commit that is not an ancestor
 * of HEAD makes the two arms read different trees.
 * Resolution fails closed when no merge base exists. Callers must fetch enough
 * history for Git to prove the configured baseline is an ancestor.
 */
export async function resolveSemanticAuditBaselineRef(
  options: SemanticAuditBaselineRefOptions = {},
): Promise<string> {
  const git = options.git ?? runGit;
  const configuredRef = options.configuredRef?.trim();
  const mergeBase = await git([
    "merge-base",
    "HEAD",
    configuredRef || "origin/main",
  ]);
  const normalized = mergeBase.ok ? mergeBase.stdout.trim() : "";
  if (normalized !== "") return normalized;
  throw new Error(
    `Unable to resolve semantic audit baseline. Set TEST_SEMANTIC_AUDIT_BASE_REF or fetch origin/main. git merge-base failed: ${mergeBase.stderr}`,
  );
}

export type GitResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | { readonly ok: false; readonly stdout: string; readonly stderr: string };

async function runGit(args: readonly string[]): Promise<GitResult> {
  const command = new Deno.Command("git", {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout).trim();
  const stderr = decoder.decode(output.stderr).trim();
  return output.success
    ? { ok: true, stdout, stderr }
    : { ok: false, stdout, stderr };
}

if (import.meta.main) {
  await main();
}
