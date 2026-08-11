/**
 * Scaffold quality gate.
 *
 * The issue this guards (veryfront-issue-inbox #475) asks that a freshly
 * created project install, run, and build with zero errors and zero lint
 * errors. Nothing enforced that: the starter templates are ordinary files
 * under `templates/files/`, but the repo's own `deno lint` never sees
 * them because they are excluded from the workspace lint — so template code
 * could (and did) ship `jsx-button-has-type`, `require-await`,
 * `no-explicit-any` and `no-unused-vars` violations that every scaffolded
 * project inherited on its first `veryfront lint`.
 *
 * This scaffolds each starter exactly the way `veryfront init` does and runs
 * the same `deno lint` that `veryfront lint` shells out to, so a template can
 * never again reach a user with a lint error in it.
 *
 * @module templates/scaffold-quality.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { runCommand } from "#veryfront/compat/process.ts";
import { createProject } from "../cli/shared/project-creation.ts";
import { STARTER_TEMPLATE_NAMES } from "./types.ts";

interface LintDiagnostic {
  code?: string;
  filename?: string;
  message?: string;
  range?: { start?: { line?: number } };
}

/** `deno lint --json` payload, narrowed to the fields this gate reports on. */
interface LintReport {
  diagnostics?: LintDiagnostic[];
  errors?: unknown[];
}

function describeDiagnostic(diagnostic: LintDiagnostic, projectDir: string): string {
  const file = (diagnostic.filename ?? "").split(projectDir).pop() ?? "";
  const line = diagnostic.range?.start?.line ?? 0;
  return `${diagnostic.code ?? "lint"} ${file.replace(/^\//, "")}:${line} ${
    diagnostic.message ?? ""
  }`;
}

async function scaffold(template: string, projectDir: string): Promise<void> {
  await createProject({
    parentDir: projectDir,
    template: template as Parameters<typeof createProject>[0]["template"],
    runtime: "node",
    features: [],
    integrations: [],
    environmentValues: {},
    conflictPolicy: "overwrite",
    installDependencies: false,
    initializeGit: false,
    includePackageMetadata: true,
  });
}

/** Run the same lint `veryfront lint` runs, and report every diagnostic. */
async function lintScaffold(projectDir: string): Promise<string[]> {
  const result = await runCommand("deno", {
    args: ["lint", "--json"],
    cwd: projectDir,
    capture: true,
  });

  const stdout = result.stdout ?? "";
  let report: LintReport;
  try {
    report = JSON.parse(stdout) as LintReport;
  } catch {
    throw new Error(
      `deno lint produced no JSON report (exit ${result.code}): ${result.stderr ?? stdout}`,
    );
  }

  return (report.diagnostics ?? []).map((diagnostic) => describeDiagnostic(diagnostic, projectDir));
}

describe("scaffolded starter templates", () => {
  for (const template of STARTER_TEMPLATE_NAMES) {
    it(`lints clean: ${template}`, async () => {
      const projectDir = await makeTempDir({ prefix: `veryfront-scaffold-${template}-` });
      try {
        await scaffold(template, projectDir);
        const problems = await lintScaffold(projectDir);
        assertEquals(
          problems,
          [],
          `\`veryfront lint\` must report nothing on a fresh ${template} project:\n  ${
            problems.join("\n  ")
          }`,
        );
      } finally {
        await remove(projectDir, { recursive: true }).catch(() => {});
      }
    });
  }
});
