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
  "version-check",
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
const SONAR_COVERAGE_JOB_EXPRESSION =
  `\${{ needs.coverage-shards.result == 'success' && needs.coverage-node-executor.result == 'success' && needs.coverage-integration-client.result == 'success' && (${SONAR_REQUIRED_CONDITION}) }}`;
const SONAR_JOB_EXPRESSION =
  `\${{ needs.sonar-coverage.result == 'success' && (${SONAR_REQUIRED_CONDITION}) }}`;
const MAIN_PUSH_CONDITION =
  "(github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.version-check.result == 'success' && (needs.version-check.outputs.is_stable == 'false' || needs.version-check.outputs.stable_release_requested == 'true'))";
const SONAR_GATE_JOB_EXPRESSION =
  `\${{ always() && !${MAIN_PUSH_CONDITION} && ${SONAR_REQUIRED_CONDITION} }}`;
const SONAR_JOB_TIMEOUT_MINUTES = 28;
const SONAR_QUALITY_GATE_TIMEOUT_SECONDS = 1200;
const SONAR_CHECK_NAME = "SonarQube Cloud quality gate";
const SONAR_SCAN_CHECK_NAME = "SonarQube Cloud scan";
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
  assert(
    Array.isArray(job.needs),
    `${context} needs must be a string or array`,
  );
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
  assert(
    !active.has(jobName),
    `workflow jobs must not contain a needs cycle at ${jobName}`,
  );

  const job = asRecord(jobs[jobName], `${jobName} job`);
  // Release selection is a main-only dependency; it never acquires a runner
  // on the merge queue path whose response budget this contract measures.
  if (jobName === "version-check") {
    assertEquals(
      job.if,
      "${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && github.ref == 'refs/heads/main' }}",
    );
    return 0;
  }
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
  return asRecord(
    jobs["sonar-quality-gate"],
    "SonarQube Cloud quality gate job",
  );
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
  assert(
    Array.isArray(job.steps),
    "SonarQube Cloud quality gate steps must be an array",
  );
  const step = job.steps.find((value) =>
    asRecord(value, "SonarQube Cloud quality gate step").name ===
      "Require server-side quality gate"
  );
  assert(step, "SonarQube Cloud quality gate must require the scanner result");
  return asRecord(step, "SonarQube Cloud quality gate result step");
}

async function runStandaloneGateCondition(
  job: YamlRecord,
  overrides: Record<string, string>,
): Promise<boolean> {
  const context: Record<string, string> = {
    "github.event_name": "push",
    "github.ref": "refs/heads/main",
    "github.repository": "veryfront/veryfront-code",
    "github.event.pull_request.head.repo.full_name": "veryfront/veryfront-code",
    "github.event.pull_request.user.login": "contributor",
    "needs.version-check.result": "success",
    "needs.version-check.outputs.is_stable": "false",
    "needs.version-check.outputs.stable_release_requested": "false",
    ...overrides,
  };
  const expression = String(job.if).slice(3, -2).replaceAll("always()", "1 == 1")
    .replace(/(?:github|needs)\.[a-zA-Z0-9_.-]+/g, (name) => {
      assert(name in context, `missing workflow condition fixture: ${name}`);
      assert(!context[name].includes("'"));
      return `'${context[name]}'`;
    }).replace(/!(?!=)/g, "! ").replaceAll("(", " ( ").replaceAll(")", " ) ");
  const output = await new Deno.Command("bash", {
    args: ["-c", `[[ ${expression} ]]`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.code === 0 || output.code === 1, new TextDecoder().decode(output.stderr));
  return output.code === 0;
}

async function runGate(
  overrides: Partial<Record<keyof typeof RESULT_ENV, string>> = {},
  options: { sonarRequired?: boolean; publisher?: "prerelease" | "release" } = {},
): Promise<Deno.CommandOutput> {
  const job = options.publisher
    ? asRecord(asRecord((await readWorkflow()).jobs, "jobs")[options.publisher], "publisher")
    : await readMergeGate();
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
  it("folds main gates into scan and publishers without new runner acquisitions", async () => {
    const jobs = asRecord((await readWorkflow()).jobs, "workflow jobs");
    for (const name of ["sonar-quality-gate", "quality-gate-merge"]) {
      assertStringIncludes(
        String(asRecord(jobs[name], name).if),
        "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      );
    }
    const sonar = asRecord(jobs.sonar, "sonar");
    assertEquals(sonarGateStep(sonar).env, { SONAR_RESULT: "${{ steps.sonar-scan.outcome }}" });
    for (const name of ["prerelease", "release"]) {
      const publisher = asRecord(jobs[name], name);
      const expected = REQUIRED_DEPENDENCIES.filter((name) => name !== "sonar-quality-gate");
      for (const dependency of [...expected, "sonar"]) {
        assert(
          jobNeeds(publisher, name).includes(dependency),
          `${name} must directly require ${dependency}`,
        );
      }
      assertEquals(asRecord(gateStep(publisher).env, "publisher gate env"), {
        SONAR_REQUIRED: SONAR_REQUIRED_EXPRESSION,
        ...RESULT_ENV,
        SONAR_RESULT: "${{ needs.sonar.result }}",
      });
      assertEquals(
        asRecord((publisher.steps as unknown[])[0], "first publisher step").name,
        "Require merge correctness dependencies",
      );
    }
  });
  it("fails closed in both publishers for every non-success correctness result", async () => {
    for (const publisher of ["prerelease", "release"] as const) {
      assertEquals((await runGate({}, { publisher })).code, 0);
      for (const resultName of Object.keys(RESULT_ENV) as (keyof typeof RESULT_ENV)[]) {
        for (const result of ["failure", "skipped", "cancelled"]) {
          assertEquals((await runGate({ [resultName]: result }, { publisher })).code, 1);
        }
      }
      const job = asRecord(asRecord((await readWorkflow()).jobs, "jobs")[publisher], publisher);
      for (
        const dependency of [
          "quality-gate-artifact",
          "tests-sentry-runtime-packages",
          "tests-windows-localhost",
          "build-binaries",
          "npm-compatibility-artifact",
          "version-check",
        ]
      ) {
        assertStringIncludes(String(job.if), `needs.${dependency}.result == 'success'`);
      }
      assertStringIncludes(String(job.if), "always() && !cancelled()");
      assertStringIncludes(
        String(job.if),
        "needs.quality-gate-merge.result == 'success' || ((github.event_name == 'push' && github.ref == 'refs/heads/main') && needs.quality-gate-merge.result == 'skipped')",
      );
    }
  });

  it("keeps standalone gates on main when no publisher is selected", async () => {
    const jobs = asRecord((await readWorkflow()).jobs, "jobs");
    for (const name of ["sonar-quality-gate", "quality-gate-merge"]) {
      const job = asRecord(jobs[name], name);
      assert(jobNeeds(job, name).includes("version-check"));
      assertStringIncludes(String(job.if), "needs.version-check.result == 'success'");
      assertStringIncludes(
        String(job.if),
        "needs.version-check.outputs.is_stable == 'false' || needs.version-check.outputs.stable_release_requested == 'true'",
      );
    }
  });

  it("selects folding only for main pushes that will publish", async () => {
    const jobs = asRecord((await readWorkflow()).jobs, "jobs");
    for (const name of ["sonar-quality-gate", "quality-gate-merge"]) {
      const job = asRecord(jobs[name], name);
      for (
        const [overrides, expected] of [
          [{}, false],
          [{ "needs.version-check.outputs.is_stable": "true" }, true],
          [{
            "needs.version-check.outputs.is_stable": "true",
            "needs.version-check.outputs.stable_release_requested": "true",
          }, false],
          [{ "needs.version-check.result": "failure" }, true],
          [{ "github.event_name": "pull_request", "github.ref": "refs/pull/123/merge" }, true],
          [{
            "github.event_name": "merge_group",
            "github.ref": "refs/heads/gh-readonly-queue/main/test",
          }, true],
          [{ "github.event_name": "workflow_dispatch" }, true],
        ] as [Record<string, string>, boolean][]
      ) {
        assertEquals(
          await runStandaloneGateCondition(job, overrides),
          expected,
          `${name} condition for ${JSON.stringify(overrides)}`,
        );
      }
    }
  });

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
    assertEquals(gate.if, `\${{ always() && !${MAIN_PUSH_CONDITION} }}`);
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
    const sonarGateEnv = asRecord(
      sonarGateStep(sonarGate).env,
      "SonarQube Cloud quality gate env",
    );
    const gate = asRecord(jobs["quality-gate-merge"], "merge quality gate job");
    const step = gateStep(gate);
    const gateEnv = asRecord(step.env, "merge quality gate result env");

    assertEquals(sonar.if, SONAR_JOB_EXPRESSION);
    assertEquals(
      asRecord(jobs["sonar-coverage"], "sonar coverage job").if,
      SONAR_COVERAGE_JOB_EXPRESSION,
    );
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
    assertEquals(sonar.name, SONAR_SCAN_CHECK_NAME);
    assertEquals(sonarGate.name, SONAR_CHECK_NAME);
    assertEquals(sonarGate.needs, ["sonar", "version-check"]);
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

  it("imports one normalized merged coverage report with pinned actions and no private-measures API", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const producer = asRecord(jobs["sonar-coverage"], "sonar coverage job");
    assert(
      Array.isArray(producer.steps),
      "sonar coverage steps must be an array",
    );
    const producerSteps = producer.steps.map((step) => asRecord(step, "sonar coverage step"));
    const downloadIndex = producerSteps.findIndex((step) =>
      step.name === "Download unit coverage lcov files"
    );
    const nativeDownloadIndex = producerSteps.findIndex((step) =>
      step.name === "Download native executor coverage lcov"
    );
    const clientDownloadIndex = producerSteps.findIndex((step) =>
      step.name === "Download integration client coverage lcov"
    );
    const setupIndex = producerSteps.findIndex((step) =>
      step.uses === "./.github/actions/setup-deno"
    );
    const mergeIndex = producerSteps.findIndex((step) =>
      step.name === "Merge coverage reports for SonarQube"
    );
    const normalizeIndex = producerSteps.findIndex((step) => step.name === "Normalize lcov paths");
    const uploadIndex = producerSteps.findIndex((step) =>
      step.name === "Upload merged Sonar coverage"
    );

    assertEquals(producer.needs, [
      "coverage-shards",
      "coverage-node-executor",
      "coverage-integration-client",
    ]);
    assert(
      downloadIndex >= 0,
      "sonar coverage must download the coverage artifacts",
    );
    assert(
      nativeDownloadIndex > downloadIndex,
      "sonar coverage must download native coverage",
    );
    assert(clientDownloadIndex > nativeDownloadIndex);
    assertEquals(
      asRecord(
        producerSteps[nativeDownloadIndex].with,
        "native coverage download options",
      ),
      {
        name: "coverage-native-executor",
        path: "coverage-profiles/coverage-native-executor",
      },
    );
    assertEquals(
      asRecord(
        producerSteps[clientDownloadIndex].with,
        "integration client coverage options",
      ),
      {
        name: "coverage-integration-client",
        path: "coverage-profiles/coverage-integration-client",
      },
    );
    assert(
      setupIndex > clientDownloadIndex,
      "sonar coverage must install pinned Deno after downloading coverage",
    );
    assert(
      mergeIndex > setupIndex,
      "sonar coverage must merge every report before normalizing",
    );
    const mergeRun = String(producerSteps[mergeIndex].run);
    assertStringIncludes(
      mergeRun,
      "deno task coverage:ci:merge -- --threshold=0",
    );
    assertStringIncludes(mergeRun, "coverage-profiles/coverage-shard-*");
    assertStringIncludes(
      mergeRun,
      "coverage-profiles/coverage-native-executor",
    );
    assertStringIncludes(
      mergeRun,
      "coverage-profiles/coverage-integration-client",
    );
    assert(
      normalizeIndex > mergeIndex,
      "sonar coverage must normalize merged coverage",
    );
    assertStringIncludes(
      String(producerSteps[normalizeIndex].run),
      'sed -i "s|^SF:${GITHUB_WORKSPACE}/|SF:|"',
    );
    assertStringIncludes(
      String(producerSteps[normalizeIndex].run),
      "coverage/lcov.info",
    );
    assert(
      uploadIndex > normalizeIndex,
      "sonar coverage must upload the normalized report",
    );
    assertEquals(
      asRecord(
        producerSteps[uploadIndex].with,
        "merged coverage upload options",
      ),
      {
        name: "coverage-sonar",
        path: "coverage/lcov.info",
        "retention-days": 1,
      },
    );
    assertEquals(
      JSON.stringify(producer).includes("secrets."),
      false,
      "the job that runs repository code must not receive secrets",
    );

    const sonar = asRecord(jobs.sonar, "sonar job");
    assert(Array.isArray(sonar.steps), "sonar steps must be an array");
    const steps = sonar.steps.map((step) => asRecord(step, "sonar step"));
    assertEquals(sonar.needs, ["sonar-coverage"]);
    const sonarDownloadIndex = steps.findIndex((step) =>
      step.name === "Download merged Sonar coverage"
    );
    const scanIndex = steps.findIndex((step) => step.name === "SonarQube Cloud scan");
    assertEquals(
      asRecord(
        steps[sonarDownloadIndex].with,
        "merged coverage download options",
      ),
      {
        name: "coverage-sonar",
        path: "coverage",
      },
    );
    assert(
      scanIndex > sonarDownloadIndex,
      "sonar must scan after downloading merged coverage",
    );
    for (const step of steps) {
      assertEquals(
        step.run,
        undefined,
        "the job holding SONAR_TOKEN must run no shell steps",
      );
      assert(
        typeof step.uses === "string" && !step.uses.startsWith("./"),
        "the job holding SONAR_TOKEN must not run repository actions",
      );
    }

    const sonarProperties = parseProperties(
      await readRepoFile("sonar-project.properties"),
    );
    assertEquals(
      sonarProperties.get("sonar.javascript.lcov.reportPaths"),
      "coverage/lcov.info",
    );

    for (const step of [...producerSteps, ...steps]) {
      if (typeof step.uses !== "string" || step.uses.startsWith("./")) continue;
      assert(
        /^[^@]+@[0-9a-f]{40}$/.test(step.uses),
        `third-party action must be pinned to a commit SHA: ${step.uses}`,
      );
    }

    const runCommands = [...producerSteps, ...steps].map((step) => String(step.run ?? "")).join(
      "\n",
    );
    assertEquals(runCommands.includes("api/measures"), false);
    assertEquals(runCommands.includes("api/qualitygates"), false);
    assertEquals(runCommands.includes("curl"), false);
  });

  it("uploads raw shard reports so block ids are normalized only in the final merge", async () => {
    const jobs = asRecord((await readWorkflow()).jobs, "cicd workflow jobs");
    const shards = asRecord(jobs["coverage-shards"], "coverage shards job");
    assert(Array.isArray(shards.steps), "coverage shard steps must be an array");
    const steps = shards.steps.map((step) => asRecord(step, "coverage shard step"));
    const runCommands = steps.map((step) => String(step.run ?? "")).join("\n");
    assertEquals(runCommands.includes("mergeLcovReports"), false);
    assertStringIncludes(runCommands, "> coverage-shard-1/history/lcov.info");
    assertStringIncludes(runCommands, "> coverage-shard-1/cli/lcov.info");
    const upload = steps.find((step) => step.name === "Upload unit coverage lcov");
    assert(upload, "coverage shards must upload their reports");
    assertEquals(
      asRecord(upload.with, "coverage shard upload options").path,
      "coverage-shard-${{ matrix.shard }}/**/lcov.info",
    );
  });

  it("runs native executor coverage independently without extending the unit coverage path", async () => {
    const jobs = asRecord((await readWorkflow()).jobs, "cicd workflow jobs");
    const native = asRecord(
      jobs["coverage-node-executor"],
      "native executor coverage job",
    );
    assertEquals(native.needs, undefined);
    assert(Number(native["timeout-minutes"]) <= 10);
    assert(Array.isArray(native.steps));
    const steps = native.steps.map((step) => asRecord(step, "native coverage step"));
    assert(steps.some((step) => step.uses === "./.github/actions/setup-deno"));
    const node = steps.find((step) => String(step.uses).startsWith("actions/setup-node@"));
    assert(node);
    assertEquals(
      asRecord(node.with, "native coverage Node version")["node-version"],
      "22",
    );
    const commands = steps.map((step) => String(step.run ?? "")).join("\n");
    assertStringIncludes(
      commands,
      "npm ci --ignore-scripts --prefix tests/node/resolver-dependencies",
    );
    assertStringIncludes(commands, "deno task coverage:ci:node-executor");
    const upload = steps.find((step) => String(step.uses).startsWith("actions/upload-artifact@"));
    assert(upload);
    assertEquals(asRecord(upload.with, "native coverage artifact options"), {
      name: "coverage-native-executor",
      path: "coverage/node-executor/lcov.info",
      "retention-days": 1,
      "if-no-files-found": "error",
    });
    const config = JSON.parse(await readRepoFile("deno.json"));
    assertEquals(
      config.tasks["coverage:ci:node-executor"],
      "node scripts/test/coverage-node-executor.mjs",
    );
    assertStringIncludes(
      config.tasks["fmt:check"],
      "deno fmt --check --config=scripts/test.deno.json scripts/test/",
    );
    const ciFormat = config.tasks["lint:ci-typescript"].split(" && ").find((
      command: string,
    ) => command.startsWith("deno fmt "));
    assert(ciFormat);
    assertEquals(
      ciFormat.includes("scripts/test/coverage-node-executor.mjs"),
      false,
    );
  });

  it("keeps the longest merge-gate path within the merge queue response budget", async () => {
    const workflow = await readWorkflow();
    const jobs = asRecord(workflow.jobs, "cicd workflow jobs");
    const mergeGatePathMinutes = longestJobPathMinutes(
      jobs,
      "quality-gate-merge",
    );
    const mergeGateTimeoutMinutes = Number(
      asRecord(
        jobs["quality-gate-merge"],
        "merge quality gate job",
      )["timeout-minutes"],
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
