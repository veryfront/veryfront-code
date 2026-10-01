import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

// A main run publishes the build its merge-queue run already tested when that
// run succeeded on the same SHA and its artifacts still exist; otherwise it
// runs the full pipeline. See scripts/ci/tested-merge-queue-run.ts.

type YamlRecord = Record<string, unknown>;

const TRUSTED =
  "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";
const SKIP_ON_REUSE = "!cancelled() && needs.tested-run.outputs.reuse != 'true'";
const REUSED_RUN_ID_EXPRESSION =
  "${{ needs.tested-run.outputs.reuse == 'true' && needs.tested-run.outputs.run_id || '' }}";

// Jobs the merge-queue run already ran on this commit.
const SKIPPED_ON_REUSE = [
  "ci",
  "tests",
  "npm-compatibility-artifact",
  "tests-windows-localhost",
  "coverage-shards",
  "coverage-node-executor",
  "coverage-integration-client",
  "tests-e2e-rsc-browser",
  "tests-binary-e2e",
  "npm-smoke-node-versions",
  "tests-sentry-runtime-packages",
  "tests-split-mode",
] as const;
// Jobs that skip because a job they need skipped.
const SKIPPED_WITH_DEPENDENCY: Record<string, string> = {
  "tests-node": "npm-compatibility-artifact",
  "tests-node-sandbox": "npm-compatibility-artifact",
  "tests-bun": "npm-compatibility-artifact",
  "tests-runtime-critical-flow": "npm-compatibility-artifact",
  "tests-npm-install-smoke": "npm-compatibility-artifact",
  "codecov-upload": "coverage-shards",
};
// Jobs that still run on a reused main run, or never run on main.
const KEPT = [
  "tested-run",
  "coverage",
  "sonar",
  "sonar-quality-gate",
  "quality-gate-merge",
  "quality-gate-artifact",
  "quality-gate-release",
  "version-check",
  "tests-proxy-binary",
  "build-binaries",
  "prerelease",
  "release",
  "quality-gate-registry",
  "dispatch-release",
  "update-homebrew",
] as const;

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

async function readJobs(): Promise<YamlRecord> {
  const workflow = asRecord(
    parse(
      await Deno.readTextFile(new URL("../../../.github/workflows/cicd.yml", import.meta.url)),
    ),
    "cicd workflow",
  );
  return asRecord(workflow.jobs, "cicd workflow jobs");
}

function job(jobs: YamlRecord, name: string): YamlRecord {
  return asRecord(jobs[name], `${name} job`);
}

function needs(value: YamlRecord): string[] {
  if (value.needs === undefined) return [];
  return typeof value.needs === "string" ? [value.needs] : value.needs as string[];
}

function steps(value: YamlRecord, context: string): YamlRecord[] {
  assert(Array.isArray(value.steps), `${context} steps must be an array`);
  return value.steps.map((step) => asRecord(step, `${context} step`));
}

function namedStep(value: YamlRecord, name: string): YamlRecord {
  const step = steps(value, name).find((candidate) => candidate.name === name);
  assert(step, `missing step ${name}`);
  return step;
}

async function runReleaseGate(env: Record<string, string>): Promise<Deno.CommandOutput> {
  const gate = job(await readJobs(), "quality-gate-release");
  return await new Deno.Command("bash", {
    args: ["-c", String(namedStep(gate, "Require release test results").run)],
    env: {
      TESTED_RUN_RESULT: "success",
      REUSED_RUN_ID: "",
      ARTIFACT_BUILD_RESULT: "success",
      SENTRY_RUNTIME_PACKAGES_RESULT: "success",
      WINDOWS_LOCALHOST_RESULT: "success",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

describe("tested merge-queue run workflow", () => {
  it("decides on main only, with read access to other runs", async () => {
    const tested = job(await readJobs(), "tested-run");

    assertEquals(tested.if, `\${{ ${TRUSTED} && github.ref == 'refs/heads/main' }}`);
    assertEquals(tested.permissions, { actions: "read", contents: "read" });
    assertEquals(tested.outputs, {
      reuse: "${{ steps.decide.outputs.reuse }}",
      run_id: "${{ steps.decide.outputs.run_id }}",
      release_number: "${{ steps.decide.outputs.release_number }}",
    });
    assertStringIncludes(
      String(namedStep(tested, "Find the tested merge-queue run").run),
      "scripts/ci/tested-merge-queue-run.ts",
    );
  });

  it("requires every artifact a reused run consumes", async () => {
    const jobs = await readJobs();
    const command = String(
      namedStep(job(jobs, "tested-run"), "Find the tested merge-queue run").run,
    );
    const shards = asRecord(
      asRecord(job(jobs, "coverage-shards").strategy, "coverage shard strategy").matrix,
      "coverage shard matrix",
    ).shard as number[];

    for (
      const artifact of [
        '"npm-compatibility-${GITHUB_SHA}"',
        ...shards.map((shard) => `coverage-shard-${shard}`),
        "coverage-native-executor",
        "coverage-integration-client",
      ]
    ) {
      assertStringIncludes(command, artifact);
    }
  });

  it("records the release number before any release job can start", async () => {
    const jobs = await readJobs();
    const upload = namedStep(job(jobs, "tested-run"), "Upload release number");

    assertEquals(
      asRecord(upload.with, "release number upload").name,
      "release-number-${{ steps.decide.outputs.release_number }}",
    );
    for (const name of ["build-binaries", "prerelease", "release"]) {
      assert(needs(job(jobs, name)).includes("tested-run"), `${name} must wait for tested-run`);
    }
  });

  it("numbers RC builds by the tested run", async () => {
    const jobs = await readJobs();

    assertEquals(
      asRecord(namedStep(job(jobs, "build-binaries"), "Prepare RC build version").env, "env")
        .VERSION,
      "${{ needs.version-check.outputs.version }}.${{ needs.tested-run.outputs.release_number }}",
    );
    assertEquals(
      asRecord(namedStep(job(jobs, "prerelease"), "Compute RC version").env, "env").RUN_NUMBER,
      "${{ needs.tested-run.outputs.release_number }}",
    );
  });

  it("skips every test job when main reuses the merge-queue run", async () => {
    const jobs = await readJobs();

    for (const name of SKIPPED_ON_REUSE) {
      const value = job(jobs, name);
      assertEquals(needs(value), ["tested-run"], `${name} must wait for tested-run`);
      assertStringIncludes(String(value.if), `\${{ ${SKIP_ON_REUSE} && ${TRUSTED}`);
    }
    for (const [name, dependency] of Object.entries(SKIPPED_WITH_DEPENDENCY)) {
      const value = job(jobs, name);
      assert(needs(value).includes(dependency), `${name} must need ${dependency}`);
      assert(
        !/always\(\)|!cancelled\(\)|failure\(\)/.test(String(value.if)),
        `${name} must skip when ${dependency} skips`,
      );
    }
  });

  it("classifies every job's behaviour on a reused main run", async () => {
    const classified = [
      ...SKIPPED_ON_REUSE,
      ...Object.keys(SKIPPED_WITH_DEPENDENCY),
      ...KEPT,
    ].sort();

    assertEquals(Object.keys(await readJobs()).sort(), classified);
  });

  it("gates releases on the release-only tests or the reused run", async () => {
    const gate = job(await readJobs(), "quality-gate-release");
    assertEquals(gate.name, "quality gate (release)");
    assertEquals(
      gate.if,
      `\${{ always() && ${TRUSTED} && github.ref == 'refs/heads/main' }}`,
    );
    assertEquals(
      asRecord(namedStep(gate, "Require release test results").env, "env").REUSED_RUN_ID,
      REUSED_RUN_ID_EXPRESSION,
    );

    assertEquals((await runReleaseGate({})).code, 0);
    const skipped = {
      ARTIFACT_BUILD_RESULT: "skipped",
      SENTRY_RUNTIME_PACKAGES_RESULT: "skipped",
      WINDOWS_LOCALHOST_RESULT: "skipped",
    };
    const reused = await runReleaseGate({ ...skipped, REUSED_RUN_ID: "36825693208" });
    assertEquals(reused.code, 0);
    assertStringIncludes(
      new TextDecoder().decode(reused.stdout),
      "WINDOWS_LOCALHOST_RESULT passed in merge-queue run 36825693208",
    );
    assertEquals((await runReleaseGate(skipped)).code, 1);
    assertEquals(
      (await runReleaseGate({ SENTRY_RUNTIME_PACKAGES_RESULT: "failure", REUSED_RUN_ID: "1" }))
        .code,
      1,
    );
    assertEquals((await runReleaseGate({ TESTED_RUN_RESULT: "failure" })).code, 1);
  });
});
