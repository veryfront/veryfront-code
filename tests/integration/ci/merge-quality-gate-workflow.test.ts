import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/cicd.yml",
  import.meta.url,
);
const REQUIRED_DEPENDENCIES = [
  "ci",
  "coverage",
  "tests",
  "tests-node",
  "tests-node-sandbox",
  "tests-bun",
  "tests-binary-e2e",
  "tests-e2e-rsc-browser",
  "sonar",
] as const;
const RESULT_ENV = {
  SOURCE_CHECKS_RESULT: "${{ needs.ci.result }}",
  COVERAGE_RESULT: "${{ needs.coverage.result }}",
  SONAR_RESULT: "${{ needs.sonar.result }}",
  INTEGRATION_TESTS_RESULT: "${{ needs.tests.result }}",
  NODE_RUNTIME_TESTS_RESULT: "${{ needs.tests-node.result }}",
  NODE_SANDBOX_TESTS_RESULT: "${{ needs.tests-node-sandbox.result }}",
  BUN_RUNTIME_TESTS_RESULT: "${{ needs.tests-bun.result }}",
  BINARY_E2E_RESULT: "${{ needs.tests-binary-e2e.result }}",
  RSC_BROWSER_E2E_RESULT: "${{ needs.tests-e2e-rsc-browser.result }}",
} as const;
const SONAR_REQUIRED_CONDITION =
  "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && (github.event_name != 'pull_request' || github.event.pull_request.user.login != 'dependabot[bot]')";
const SONAR_REQUIRED_EXPRESSION = `\${{ ${SONAR_REQUIRED_CONDITION} }}`;
const SONAR_JOB_EXPRESSION =
  `\${{ needs.coverage-shards.result == 'success' && (${SONAR_REQUIRED_CONDITION}) }}`;

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

async function readWorkflow(): Promise<YamlRecord> {
  return asRecord(
    parse(await Deno.readTextFile(WORKFLOW_PATH)),
    "cicd workflow",
  );
}

async function readRepoFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../../../${path}`, import.meta.url));
}

async function readMergeGate(): Promise<YamlRecord> {
  const workflow = await readWorkflow();
  const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
  return asRecord(jobs["quality-gate-merge"], "merge quality gate job");
}

function gateStep(job: YamlRecord): YamlRecord {
  assert(Array.isArray(job.steps), "merge quality gate steps must be an array");
  const step = job.steps.find((value) =>
    asRecord(value, "merge quality gate step").name ===
      "Require merge correctness dependencies"
  );
  assert(step, "merge quality gate must require its dependencies");
  return asRecord(step, "merge quality gate result step");
}

async function runGate(
  overrides: Partial<Record<keyof typeof RESULT_ENV, string>> = {},
  options: { sonarRequired?: boolean } = {},
): Promise<Deno.CommandOutput> {
  const job = await readMergeGate();
  const step = gateStep(job);
  const env = Object.fromEntries(
    Object.keys(RESULT_ENV).map((name) => {
      const resultName = name as keyof typeof RESULT_ENV;
      return [resultName, overrides[resultName] ?? "success"];
    }),
  );
  return await new Deno.Command("bash", {
    args: ["-c", String(step.run)],
    env: {
      ...env,
      SONAR_REQUIRED: String(options.sonarRequired ?? true),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

describe("merge quality gate workflow", () => {
  it("exposes one stable check name for branch protection", async () => {
    const gate = await readMergeGate();

    assertEquals(gate.name, "quality gate (merge)");
  });

  it("reports the same gate on pull requests and merge queue runs", async () => {
    const workflow = await readWorkflow();
    const triggers = asRecord(workflow.on, "cicd workflow triggers");

    assert("pull_request" in triggers, "workflow must run for pull requests");
    assert(
      "merge_group" in triggers,
      "workflow must run for merge queue entries",
    );
  });

  it("shows merge-queue CI status without including release failures in the README badge", async () => {
    const readme = await readRepoFile("README.md");

    assertStringIncludes(
      readme,
      "actions/workflows/cicd.yml/badge.svg?event=merge_group",
    );
    assertEquals(
      readme.includes("actions/workflows/cicd.yml/badge.svg?branch=main"),
      false,
    );
  });

  it("always reads every required dependency result", async () => {
    const gate = await readMergeGate();
    const step = gateStep(gate);

    assertEquals(gate.needs, REQUIRED_DEPENDENCIES);
    assertEquals(gate.if, "${{ always() }}");
    assertEquals(
      asRecord(step.env, "merge quality gate result env"),
      {
        SONAR_REQUIRED: SONAR_REQUIRED_EXPRESSION,
        ...RESULT_ENV,
      },
    );
  });

  it("keeps Sonar execution and merge-gate enforcement on the same trust condition", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const sonar = asRecord(jobs.sonar, "sonar job");
    const gate = asRecord(jobs["quality-gate-merge"], "merge quality gate job");
    const step = gateStep(gate);
    const gateEnv = asRecord(step.env, "merge quality gate result env");

    assertEquals(sonar.if, SONAR_JOB_EXPRESSION);
    assertEquals(gateEnv.SONAR_REQUIRED, SONAR_REQUIRED_EXPRESSION);
  });

  it("documents Sonar enforcement for manually dispatched runs", async () => {
    const qualityGates = await readRepoFile(".github/QUALITY_GATES.md");

    assertStringIncludes(qualityGates, "manually dispatched runs");
  });

  it("blocks every release path on the complete merge correctness gate", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");

    for (const jobName of ["prerelease", "release"] as const) {
      const job = asRecord(jobs[jobName], `${jobName} job`);
      assert(Array.isArray(job.needs), `${jobName} needs must be an array`);
      assert(
        job.needs.includes("quality-gate-merge"),
        `${jobName} must wait for the complete merge correctness gate`,
      );
    }
  });

  it("preserves all required coverage shards, the aggregate gate, and the floor", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const coverageShards = asRecord(
      jobs["coverage-shards"],
      "coverage shards job",
    );
    const strategy = asRecord(
      coverageShards.strategy,
      "coverage shard strategy",
    );
    const matrix = asRecord(strategy.matrix, "coverage shard matrix");
    const coverage = asRecord(jobs.coverage, "coverage gate job");

    assertEquals(matrix.shard, [1, 2, 3, 4]);
    assertEquals("unit-tests" in jobs, false);
    assertEquals(coverage.name, "coverage gate");
    assertEquals(coverage.needs, ["coverage-shards"]);
    assertStringIncludes(
      await readRepoFile("scripts/test/coverage-ci.ts"),
      'readOption(args, "--threshold") ?? "80"',
    );
  });

  it("runs changed CI TypeScript through one reproducible static gate", async () => {
    const denoConfig = JSON.parse(await readRepoFile("deno.json")) as {
      tasks: Record<string, string>;
    };
    const task = denoConfig.tasks["lint:ci-typescript"];

    assert(task, "deno.json must define lint:ci-typescript");
    assertStringIncludes(
      task,
      "deno check --unstable-sloppy-imports --frozen --config=scripts/test.deno.json",
    );
    assertStringIncludes(task, "scripts/ci/npm-compatibility-artifact.ts");
    assertStringIncludes(task, "scripts/ci/registry-release-integrity.ts");
    assertStringIncludes(task, "tests/integration/ci/");
    const formatCommand = task.split(" && ").find((command) =>
      command.startsWith("deno fmt --check")
    );
    assert(formatCommand, "lint:ci-typescript must include a format check");
    for (
      const ciTypeScriptFile of [
        "scripts/ci/npm-compatibility-artifact.ts",
        "scripts/ci/registry-release-integrity.ts",
        "scripts/ci/registry-release-integrity.test.ts",
      ]
    ) {
      assertStringIncludes(
        formatCommand,
        ciTypeScriptFile,
        `${ciTypeScriptFile} must be covered by the format check`,
      );
    }
    for (const entrypoint of ["lint:ci", "verify", "verify:quick"]) {
      const entrypointTask = denoConfig.tasks[entrypoint];
      assert(entrypointTask, `deno.json must define ${entrypoint}`);
      assertStringIncludes(
        entrypointTask,
        "deno task lint:ci-typescript",
        `${entrypoint} must run the CI TypeScript static gate`,
      );
    }
  });

  it("succeeds only when every required dependency succeeds", async () => {
    const result = await runGate();

    assertEquals(result.code, 0);
  });

  it("fails closed for every non-success dependency result", async () => {
    for (const resultName of Object.keys(RESULT_ENV)) {
      for (const dependencyResult of ["failure", "skipped", "cancelled"]) {
        const result = await runGate({
          [resultName]: dependencyResult,
        });
        const output = new TextDecoder().decode(result.stdout);

        assertEquals(
          result.code,
          1,
          `${resultName}=${dependencyResult} must fail the merge gate`,
        );
        assertStringIncludes(
          output,
          `${resultName} finished with ${dependencyResult}`,
        );
      }
    }
  });

  it("allows intentional Sonar skips when pull requests cannot receive secrets", async () => {
    for (const dependencyResult of ["skipped", "success"]) {
      const result = await runGate(
        { SONAR_RESULT: dependencyResult },
        { sonarRequired: false },
      );

      assertEquals(
        result.code,
        0,
        `SONAR_RESULT=${dependencyResult} must not fail the merge gate when Sonar is intentionally skipped`,
      );
    }
  });
});
