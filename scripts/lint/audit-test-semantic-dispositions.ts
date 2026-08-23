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

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    boolean: ["json"],
    default: { json: false },
  });
  const result = await collectSemanticAuditCandidates({
    root: ".",
    dispositions: TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
  });
  const baselineErrors = compareSemanticDispositionBaseline(
    TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
    await resolveSemanticBaselineFromGit(),
  );
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
    console.error("Semantic unit-boundary audit failed:");
    for (const error of errors) console.error(`  ${error}`);
    console.error(
      `\nDo not grow ${MIGRATION_FILE_PATH}; move the test to integration/e2e or make the unit hermetic.`,
    );
    Deno.exit(1);
  }

  const disposed = TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES.length;
  if (disposed > result.candidates.length) {
    console.log(
      `Semantic unit-boundary debt shrank to ${result.candidates.length} file(s). ` +
        `Regenerate ${MIGRATION_FILE_PATH} to remove stale dispositions.`,
    );
    return;
  }

  console.log(
    `Semantic unit-boundary audit ok: ${result.consideredFiles} unit executable(s) considered; ` +
      `${result.candidates.length} effect-bearing file(s) disposed.`,
  );
}

async function resolveSemanticBaselineFromGit(): Promise<
  SemanticDispositionBaseline
> {
  const ref = Deno.env.get("TEST_SEMANTIC_AUDIT_BASE_REF")?.trim() ||
    await resolveLocalBaselineRef();
  const commitCheck = await runGit(["cat-file", "-e", `${ref}^{commit}`]);
  if (!commitCheck.ok) {
    return {
      kind: "malformed",
      ref,
      reason: `base ref is not a commit: ${commitCheck.stderr}`,
    };
  }
  const fileCheck = await runGit([
    "cat-file",
    "-e",
    `${ref}:${MIGRATION_FILE_PATH}`,
  ]);
  if (!fileCheck.ok) return { kind: "missing", ref };
  const source = await runGit(["show", `${ref}:${MIGRATION_FILE_PATH}`]);
  if (!source.ok) {
    return {
      kind: "malformed",
      ref,
      reason: `base semantic inventory could not be read: ${source.stderr}`,
    };
  }
  return parseSemanticDispositionBaselineSource(source.stdout, ref);
}

async function resolveLocalBaselineRef(): Promise<string> {
  const mergeBase = await runGit(["merge-base", "HEAD", "origin/main"]);
  if (!mergeBase.ok || mergeBase.stdout.trim() === "") {
    throw new Error(
      `Unable to resolve semantic audit baseline. Set TEST_SEMANTIC_AUDIT_BASE_REF or fetch origin/main. git merge-base failed: ${mergeBase.stderr}`,
    );
  }
  return mergeBase.stdout.trim();
}

async function runGit(args: readonly string[]): Promise<
  { readonly ok: true; readonly stdout: string; readonly stderr: string } | {
    readonly ok: false;
    readonly stdout: string;
    readonly stderr: string;
  }
> {
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
