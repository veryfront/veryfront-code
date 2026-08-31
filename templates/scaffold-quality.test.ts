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
 * The same exclusion hid type errors: `step()` was handed an `execute`
 * callback `StepOptions` does not accept, `getAgentsAsTools` a list of ids
 * where it takes a description map, and `readDir`'s async iterable was
 * filtered like an array — three templates failed `tsc --noEmit` on a fresh
 * `npm install`.
 *
 * This scaffolds each starter exactly the way `veryfront init` does, then runs
 * the same `deno lint` that `veryfront lint` shells out to, and type-checks
 * the agents, tools and workflows against the framework's real declarations —
 * so a template can never again reach a user with an error in it.
 *
 * @module templates/scaffold-quality.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl, join } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
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

/**
 * Repo config, so `veryfront/*` resolves to the framework's own declarations.
 *
 * `fromFileUrl`, not `URL.pathname`: on Windows the latter yields
 * `/C:/repo/deno.json`, which `deno` cannot open.
 */
const REPO_CONFIG = fromFileUrl(new URL("../deno.json", import.meta.url));

/**
 * Framework definitions outside the client app.
 *
 * Discover files instead of maintaining a directory allowlist, so agents,
 * evals, integrations, prompts, resources, schedules, skills, tasks, tools,
 * triggers, webhooks, workflows, and future definition roots stay covered.
 */
async function serverSourceFiles(projectDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(projectDir, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
    })
  ) {
    const relativePath = entry.path.slice(projectDir.length + 1).replaceAll("\\", "/");
    if (relativePath.startsWith("app/")) continue;
    files.push(entry.path);
  }
  return files.sort();
}

/** Type-check source files against the framework declarations. */
async function typeCheckFiles(projectDir: string, files: string[]): Promise<string> {
  if (files.length === 0) return "";

  const result = await runCommand("deno", {
    args: ["check", "--config", REPO_CONFIG, ...files],
    cwd: projectDir,
    capture: true,
  });

  return result.code === 0 ? "" : (result.stderr ?? result.stdout ?? "type check failed");
}

/** Type-check a scaffold's server code against the framework declarations. */
async function typeCheckScaffold(projectDir: string): Promise<string> {
  return await typeCheckFiles(projectDir, await serverSourceFiles(projectDir));
}

/** Client and route code shipped by the agentic workflow starter. */
async function agenticWorkflowAppFiles(projectDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(join(projectDir, "app"), {
      includeDirs: false,
      exts: [".ts", ".tsx"],
    })
  ) {
    files.push(entry.path);
  }
  files.push(join(projectDir, "globals.d.ts"));
  return files.sort();
}

describe("scaffolded starter templates", () => {
  for (const template of STARTER_TEMPLATE_NAMES) {
    it(`type-checks against the framework: ${template}`, async () => {
      const projectDir = await makeTempDir({ prefix: `veryfront-types-${template}-` });
      try {
        await scaffold(template, projectDir);
        assertEquals(
          await typeCheckScaffold(projectDir),
          "",
          `a fresh ${template} project must type-check against the framework it installs`,
        );
      } finally {
        await remove(projectDir, { recursive: true }).catch(() => {});
      }
    });

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

  it("type-checks the agentic workflow app against workflow hook contracts", async () => {
    const projectDir = await makeTempDir({ prefix: "veryfront-types-agentic-workflow-app-" });
    try {
      await scaffold("agentic-workflow", projectDir);
      assertEquals(
        await typeCheckFiles(projectDir, await agenticWorkflowAppFiles(projectDir)),
        "",
        "the agentic workflow app must use the public workflow hook response types",
      );
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => {});
    }
  });
});
