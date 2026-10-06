import { fromFileUrl, join } from "#std/path";
import { parse } from "#std/yaml/parse";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/cicd.yml",
  import.meta.url,
);

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

async function migrationBaselineStep(): Promise<string> {
  const workflow = asRecord(
    parse(await Deno.readTextFile(WORKFLOW_PATH)),
    "CI workflow",
  );
  const jobs = asRecord(workflow.jobs, "CI workflow jobs");
  const ci = asRecord(jobs.ci, "CI workflow job");
  assert(Array.isArray(ci.steps), "CI workflow job must define steps");
  const step = ci.steps.find((value) =>
    asRecord(value, "CI workflow step").name ===
      "Configure test migration baselines"
  );
  assert(step, "CI workflow must configure test migration baselines");
  return String(asRecord(step, "migration baseline step").run);
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function expectGit(
  cwd: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  const result = await runGit(cwd, args);
  assertEquals(result.code, 0, `git ${args[0]} must succeed`);
  return result;
}

describe("test migration baseline workflow", () => {
  it("keeps baseline-resolution failures machine-readable in JSON mode", async () => {
    const repository = new URL("../../../", import.meta.url);
    const fixture = await makeTempDir({ prefix: "semantic-baseline-json-" });
    try {
      await expectGit(fixture, ["init", "--initial-branch=main"]);
      await Deno.mkdir(join(fixture, "src"));
      await Deno.writeTextFile(
        join(fixture, "src", "fixture.test.ts"),
        'Deno.test("baseline fixture", () => {});\n',
      );
      await expectGit(fixture, ["config", "user.email", "test@example.invalid"]);
      await expectGit(fixture, ["config", "user.name", "Test"]);
      await expectGit(fixture, ["add", "src/fixture.test.ts"]);
      await expectGit(fixture, ["commit", "--message", "baseline fixture"]);
      await expectGit(fixture, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
      const missingBaseline = "refs/heads/missing-semantic-baseline";
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${fromFileUrl(new URL("scripts/test.deno.json", repository))}`,
          "--no-check",
          "--allow-read",
          "--allow-run=git",
          "--allow-env=TEST_SEMANTIC_AUDIT_BASE_REF",
          fromFileUrl(new URL("scripts/lint/audit-test-semantic-dispositions.ts", repository)),
          "--json",
        ],
        cwd: fixture,
        env: {
          TEST_SEMANTIC_AUDIT_BASE_REF: missingBaseline,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(result.code, 1, "an unresolved baseline must fail the audit");
      const stdout = new TextDecoder().decode(result.stdout).trim();
      assert(
        stdout.length > 0,
        `the audit must emit JSON, stderr: ${new TextDecoder().decode(result.stderr)}`,
      );
      const report = JSON.parse(stdout) as { errors?: unknown };
      assert(
        Array.isArray(report.errors) &&
          report.errors.some((error) =>
            typeof error === "string" &&
            error.includes("semantic audit baseline resolution failed") &&
            error.includes(missingBaseline)
          ),
        `the JSON report must contain the baseline failure, got: ${stdout}`,
      );
      assertEquals(
        new TextDecoder().decode(result.stderr),
        "",
        "JSON mode must not mix prose or an uncaught stack trace into stderr",
      );
    } finally {
      await remove(fixture, { recursive: true });
    }
  });

  it("creates origin/main before resolving a shallow fallback baseline", async () => {
    // Production break caught: an unqualified `git fetch --unshallow origin
    // main` only updates FETCH_HEAD in a shallow non-main checkout, leaving
    // the configured origin/main baseline absent for the later merge-base.
    const root = await makeTempDir({ prefix: "test-migration-baseline-" });
    const source = join(root, "source");
    const remote = join(root, "remote.git");
    const shallow = join(root, "shallow");

    try {
      await expectGit(root, ["init", "--initial-branch=main", source]);
      await expectGit(source, ["config", "user.email", "test@example.invalid"]);
      await expectGit(source, ["config", "user.name", "Test"]);
      await expectGit(source, ["commit", "--allow-empty", "--message", "base"]);
      await expectGit(source, ["switch", "--create", "feature"]);
      await expectGit(source, [
        "commit",
        "--allow-empty",
        "--message",
        "feature",
      ]);
      await expectGit(root, ["init", "--bare", remote]);
      await expectGit(source, ["remote", "add", "origin", remote]);
      await expectGit(source, ["push", "origin", "main", "feature"]);
      await expectGit(root, [
        "clone",
        "--depth=1",
        "--branch",
        "feature",
        `file://${remote}`,
        shallow,
      ]);

      assertEquals(
        new TextDecoder().decode(
          (await expectGit(shallow, ["rev-parse", "--is-shallow-repository"]))
            .stdout,
        ).trim(),
        "true",
      );
      assertEquals(
        (await runGit(shallow, [
          "show-ref",
          "--verify",
          "--quiet",
          "refs/remotes/origin/main",
        ]))
          .code,
        1,
      );

      const workflowResult = await new Deno.Command("bash", {
        args: ["-c", await migrationBaselineStep()],
        cwd: shallow,
        env: {
          EVENT_NAME: "workflow_dispatch",
          PR_BASE_SHA: "",
          MERGE_GROUP_BASE_SHA: "",
          PUSH_BASE_SHA: "",
          GITHUB_ENV: join(root, "github-env"),
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        workflowResult.code,
        0,
        "the fallback migration step must succeed",
      );
      await expectGit(shallow, [
        "show-ref",
        "--verify",
        "refs/remotes/origin/main",
      ]);
      await expectGit(shallow, ["merge-base", "HEAD", "origin/main"]);
    } finally {
      await remove(root, { recursive: true });
    }
  });
});
