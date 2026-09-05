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
  "sonar-quality-gate",
] as const;
const RESULT_ENV = {
  SOURCE_CHECKS_RESULT: "${{ needs.ci.result }}",
  COVERAGE_RESULT: "${{ needs.coverage.result }}",
  SONAR_RESULT: "${{ needs.sonar-quality-gate.result }}",
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
const SONAR_GATE_JOB_EXPRESSION = `\${{ always() && ${SONAR_REQUIRED_CONDITION} }}`;
const SONAR_JOB_TIMEOUT_MINUTES = 35;
const SONAR_QUALITY_GATE_TIMEOUT_SECONDS = 1200;
const SONAR_CHECK_NAME = "SonarQube Cloud quality gate";
const LEGACY_SONAR_CHECK_NAME = "sonar";
const MERGE_QUEUE_RESPONSE_TIMEOUT_MINUTES = 70;
const MERGE_QUEUE_SCHEDULING_HEADROOM_MINUTES = 8;

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

function parseProperties(content: string): Map<string, string> {
  const properties = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    assert(separator > 0, `invalid property line: ${line}`);
    properties.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }

  return properties;
}

function jobNeeds(job: YamlRecord, context: string): string[] {
  if (job.needs === undefined) return [];
  if (typeof job.needs === "string") return [job.needs];
  assert(Array.isArray(job.needs), `${context} needs must be a string or array`);
  assert(
    job.needs.every((dependency) => typeof dependency === "string"),
    `${context} needs entries must be job names`,
  );
  return job.needs as string[];
}

function longestJobPathMinutes(
  jobs: YamlRecord,
  jobName: string,
  memo = new Map<string, number>(),
  active = new Set<string>(),
): number {
  const cached = memo.get(jobName);
  if (cached !== undefined) return cached;
  assert(!active.has(jobName), `workflow jobs must not contain a needs cycle at ${jobName}`);

  const job = asRecord(jobs[jobName], `${jobName} job`);
  const timeout = Number(job["timeout-minutes"]);
  assert(
    Number.isFinite(timeout) && timeout > 0,
    `${jobName} must have a positive timeout-minutes value`,
  );

  active.add(jobName);
  const dependencies = jobNeeds(job, `${jobName} job`);
  const dependencyMinutes = dependencies.length === 0 ? 0 : Math.max(
    ...dependencies.map((dependency) => longestJobPathMinutes(jobs, dependency, memo, active)),
  );
  active.delete(jobName);

  const total = timeout + dependencyMinutes;
  memo.set(jobName, total);
  return total;
}

async function readMergeGate(): Promise<YamlRecord> {
  const workflow = await readWorkflow();
  const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
  return asRecord(jobs["quality-gate-merge"], "merge quality gate job");
}

async function readSonarGate(): Promise<YamlRecord> {
  const workflow = await readWorkflow();
  const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
  return asRecord(jobs["sonar-quality-gate"], "SonarQube Cloud quality gate job");
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

function sonarGateStep(job: YamlRecord): YamlRecord {
  assert(Array.isArray(job.steps), "SonarQube Cloud quality gate steps must be an array");
  const step = job.steps.find((value) =>
    asRecord(value, "SonarQube Cloud quality gate step").name ===
      "Require server-side quality gate"
  );
  assert(step, "SonarQube Cloud quality gate must require the scanner result");
  return asRecord(step, "SonarQube Cloud quality gate result step");
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

async function runSonarGate(
  sonarResult: string,
): Promise<Deno.CommandOutput> {
  const step = sonarGateStep(await readSonarGate());
  return await new Deno.Command("bash", {
    args: ["-c", String(step.run)],
    env: {
      SONAR_RESULT: sonarResult,
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
    const sonarGate = asRecord(
      jobs["sonar-quality-gate"],
      "SonarQube Cloud quality gate job",
    );
    const sonarGateEnv = asRecord(sonarGateStep(sonarGate).env, "SonarQube Cloud quality gate env");
    const gate = asRecord(jobs["quality-gate-merge"], "merge quality gate job");
    const step = gateStep(gate);
    const gateEnv = asRecord(step.env, "merge quality gate result env");

    assertEquals(sonar.if, SONAR_JOB_EXPRESSION);
    assertEquals(sonarGate.if, SONAR_GATE_JOB_EXPRESSION);
    assertEquals(sonarGateEnv.SONAR_RESULT, "${{ needs.sonar.result }}");
    assertEquals(gateEnv.SONAR_REQUIRED, SONAR_REQUIRED_EXPRESSION);
  });

  it("makes the required Sonar check wait for the server-side quality gate", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const sonar = asRecord(jobs.sonar, "sonar job");
    const sonarGate = asRecord(
      jobs["sonar-quality-gate"],
      "SonarQube Cloud quality gate job",
    );
    assertEquals(sonar.name, LEGACY_SONAR_CHECK_NAME);
    assertEquals(sonarGate.name, SONAR_CHECK_NAME);
    assertEquals(sonarGate.needs, ["sonar"]);
    assertEquals(sonarGate.if, SONAR_GATE_JOB_EXPRESSION);
    const sonarProperties = parseProperties(
      await readRepoFile("sonar-project.properties"),
    );

    assertEquals(sonar["timeout-minutes"], SONAR_JOB_TIMEOUT_MINUTES);
    assertEquals(
      sonarProperties.get("sonar.qualitygate.wait"),
      "true",
    );
    assertEquals(
      sonarProperties.get("sonar.qualitygate.timeout"),
      String(SONAR_QUALITY_GATE_TIMEOUT_SECONDS),
    );
  });

  it("makes the canonical Sonar check fail closed for required analysis", async () => {
    assertEquals((await runSonarGate("success")).code, 0);
    for (const result of ["failure", "skipped", "cancelled"]) {
      assertEquals(
        (await runSonarGate(result)).code,
        1,
        `required Sonar result ${result} must fail the canonical check`,
      );
    }
  });

  it("imports normalized shard coverage with pinned actions and no private-measures API", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const sonar = asRecord(jobs.sonar, "sonar job");
    assert(Array.isArray(sonar.steps), "sonar steps must be an array");
    const steps = sonar.steps.map((step) => asRecord(step, "sonar step"));
    const downloadIndex = steps.findIndex((step) =>
      step.name === "Download unit coverage lcov files"
    );
    const normalizeIndex = steps.findIndex((step) => step.name === "Normalize lcov paths");
    const scanIndex = steps.findIndex((step) => step.name === "SonarQube Cloud scan");

    assert(downloadIndex >= 0, "sonar must download the coverage artifacts");
    assert(
      normalizeIndex > downloadIndex,
      "sonar must normalize downloaded coverage",
    );
    assert(
      scanIndex > normalizeIndex,
      "sonar must scan after coverage normalization",
    );
    assertStringIncludes(
      String(steps[normalizeIndex].run),
      'sed -i "s|^SF:${GITHUB_WORKSPACE}/|SF:|"',
    );

    const sonarProperties = parseProperties(
      await readRepoFile("sonar-project.properties"),
    );
    assertEquals(
      sonarProperties.get("sonar.javascript.lcov.reportPaths"),
      "coverage-profiles/coverage-shard-*/lcov.info",
    );

    for (const step of steps) {
      if (typeof step.uses !== "string" || step.uses.startsWith("./")) continue;
      assert(
        /^[^@]+@[0-9a-f]{40}$/.test(step.uses),
        `third-party action must be pinned to a commit SHA: ${step.uses}`,
      );
    }

    const runCommands = steps.map((step) => String(step.run ?? "")).join("\n");
    assertEquals(runCommands.includes("api/measures"), false);
    assertEquals(runCommands.includes("api/qualitygates"), false);
    assertEquals(runCommands.includes("curl"), false);
  });

  it("keeps the longest merge-gate path within the merge queue response budget", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const mergeGatePathMinutes = longestJobPathMinutes(jobs, "quality-gate-merge");
    const mergeGateTimeoutMinutes = Number(
      asRecord(jobs["quality-gate-merge"], "merge quality gate job")["timeout-minutes"],
    );
    const sonarPathMinutes = longestJobPathMinutes(jobs, "sonar-quality-gate") +
      mergeGateTimeoutMinutes;
    const qualityGates = await readRepoFile(".github/QUALITY_GATES.md");

    assert(
      mergeGatePathMinutes + MERGE_QUEUE_SCHEDULING_HEADROOM_MINUTES <=
        MERGE_QUEUE_RESPONSE_TIMEOUT_MINUTES,
      "merge queue response timeout must cover the longest transitive merge-gate path with scheduling headroom",
    );
    assertStringIncludes(
      qualityGates,
      `at least ${MERGE_QUEUE_RESPONSE_TIMEOUT_MINUTES} minutes`,
    );
    assertStringIncludes(qualityGates, `${sonarPathMinutes}-minute maximum`);
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
