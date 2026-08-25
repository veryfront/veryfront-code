import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import { NPM_SMOKE_NODE_VERSIONS } from "../../../scripts/build/runtime-support.ts";

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

function jobSteps(job: YamlRecord, context: string): YamlRecord[] {
  assert(Array.isArray(job.steps), `${context} steps must be an array`);
  return job.steps.map((step) => asRecord(step, `${context} step`));
}

async function readJobs(): Promise<YamlRecord> {
  const workflow = asRecord(
    parse(await Deno.readTextFile(WORKFLOW_PATH)),
    "CI workflow",
  );
  return asRecord(workflow.jobs, "CI workflow jobs");
}

function namedStep(job: YamlRecord, name: string): YamlRecord {
  const step = jobSteps(job, String(job.name)).find((step) => step.name === name);
  assert(step, `${String(job.name)} must include ${name}`);
  return step;
}

async function runArtifactGate(
  overrides: Record<string, string> = {},
): Promise<Deno.CommandOutput> {
  const jobs = await readJobs();
  const gate = asRecord(jobs["quality-gate-artifact"], "artifact gate");
  const step = namedStep(gate, "Require canonical artifact compatibility");
  return await new Deno.Command("bash", {
    args: ["-c", String(step.run)],
    env: {
      ARTIFACT_BUILD_RESULT: "success",
      NPM_SMOKE_RESULT: "success",
      RUNTIME_CRITICAL_FLOW_RESULT: "success",
      ...overrides,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

describe("canonical npm artifact workflow", () => {
  it("builds and uploads one SHA-addressed package artifact", async () => {
    const jobs = await readJobs();
    const producer = asRecord(
      jobs["npm-compatibility-artifact"],
      "npm compatibility artifact producer",
    );
    const steps = jobSteps(producer, "npm compatibility artifact producer");

    assertEquals(producer.name, "npm compatibility artifact");
    assertEquals(
      steps.filter((step) => String(step.run).includes("deno task build:npm"))
        .length,
      1,
      "The canonical producer must build npm output exactly once",
    );
    assert(
      steps.some((step) =>
        String(step.run).includes(
          "scripts/ci/npm-compatibility-artifact.ts pack",
        )
      ),
      "The producer must create the package-version and SHA-256 manifest",
    );
    const upload = steps.find((step) => String(step.uses).startsWith("actions/upload-artifact@"));
    assert(upload, "The producer must upload the canonical package set");
    assertEquals(
      asRecord(upload.with, "artifact upload inputs").name,
      "npm-compatibility-${{ github.sha }}",
    );
    assertEquals(
      asRecord(upload.with, "artifact upload inputs").path,
      "dist/npm-compatibility",
    );
    assertEquals(
      asRecord(upload.with, "artifact upload inputs")["retention-days"],
      30,
      "The tested npm artifact must remain available through production approval",
    );
    assertEquals(
      asRecord(producer.outputs, "producer outputs").build_duration_seconds,
      "${{ steps.build.outputs.build_duration_seconds }}",
    );
    const buildStep = namedStep(producer, "Build and pack tested npm output");
    const buildScript = String(buildStep.run);
    assertStringIncludes(
      buildScript,
      'VERSION="${BASE_VERSION}.${GITHUB_RUN_NUMBER}"',
    );
    assert(
      buildScript.indexOf("scripts/ci/prepare-rc-build.ts") <
        buildScript.indexOf("deno task build:npm"),
      "The producer must prepare the numbered RC version before it builds npm output",
    );
  });

  it("feeds the same downloaded artifact to existing smoke and runtime flows", async () => {
    const jobs = await readJobs();
    const smoke = asRecord(
      jobs["tests-npm-install-smoke"],
      "npm install smoke",
    );
    const runtime = asRecord(
      jobs["tests-runtime-critical-flow"],
      "runtime critical flow",
    );

    assertEquals(smoke.needs, [
      "npm-smoke-node-versions",
      "npm-compatibility-artifact",
    ]);
    assertEquals(runtime.needs, ["npm-compatibility-artifact"]);
    for (
      const [job, label] of [
        [smoke, "npm smoke"],
        [runtime, "runtime critical flow"],
      ] as const
    ) {
      const download = jobSteps(job, label).find((step) =>
        String(step.uses).startsWith("actions/download-artifact@")
      );
      assert(download, `${label} must download the canonical artifact`);
      assertEquals(
        asRecord(download.with, `${label} download inputs`).name,
        "npm-compatibility-${{ github.sha }}",
      );
    }

    const smokeStep = namedStep(smoke, "Clean-room install/import smoke");
    assertEquals(smokeStep.run, "bash scripts/test/npm-install-smoke.sh");
    assertEquals(
      asRecord(smokeStep.env, "npm smoke environment").VF_NPM_PACK_DIR,
      "${{ github.workspace }}/dist/npm-compatibility",
    );
    assertStringIncludes(
      String(namedStep(smoke, "Materialize canonical npm output").run),
      "npm-compatibility-artifact.ts materialize dist/npm-compatibility npm",
    );
    assertEquals(
      namedStep(smoke, "Check published package types").run,
      "deno task typecheck:consumer --skip-build",
    );
    assertStringIncludes(
      String(namedStep(runtime, "Run runtime critical flow").run),
      "scripts/test/runtime-inference-critical-flow.ts --runtime=${{ matrix.runtime }} --packed-dir=dist/npm-compatibility",
    );
    for (
      const [job, label] of [
        [smoke, "npm smoke"],
        [runtime, "runtime critical flow"],
      ] as const
    ) {
      assertEquals(
        jobSteps(job, label).filter((step) => String(step.run).includes("deno task build:npm"))
          .length,
        0,
        `${label} must not rebuild the canonical npm output`,
      );
    }
  });

  it("publishes the tested artifact for both prerelease and stable releases", async () => {
    const jobs = await readJobs();
    for (const jobName of ["prerelease", "release"] as const) {
      const job = asRecord(jobs[jobName], `${jobName} job`);
      assert(
        Array.isArray(job.needs) &&
          job.needs.includes("npm-compatibility-artifact"),
        `${jobName} must depend on the canonical npm artifact`,
      );
      const download = jobSteps(job, `${jobName} job`).find((step) =>
        String(step.uses).startsWith("actions/download-artifact@") &&
        asRecord(step.with, `${jobName} artifact download`).name ===
          "npm-compatibility-${{ github.sha }}"
      );
      assert(download, `${jobName} must download the tested npm artifact`);
      const publish = namedStep(
        job,
        jobName === "prerelease"
          ? "Publish tested RC npm artifact"
          : "Publish tested stable npm artifact",
      );
      assertStringIncludes(
        String(publish.run),
        "npm-compatibility-artifact.ts materialize dist/npm-compatibility npm",
      );
      assertEquals(
        asRecord(publish.env, `${jobName} publish environment`).NPM_PACK_DIR,
        "${{ github.workspace }}/dist/npm-compatibility",
        `${jobName} must publish the verified canonical tarballs`,
      );
      assertEquals(
        jobSteps(job, `${jobName} job`).filter((step) =>
          String(step.run).includes("deno task build:npm")
        ).length,
        0,
        `${jobName} must not rebuild the tested npm artifact`,
      );
    }
  });

  it("prepares the numbered RC version before prerelease SBOM generation", async () => {
    const jobs = await readJobs();
    const prerelease = asRecord(jobs.prerelease, "prerelease job");
    const prereleaseSteps = jobSteps(prerelease, "prerelease job");
    const prepareSbom = namedStep(prerelease, "Prepare RC checkout for SBOM");
    const generateSbom = namedStep(prerelease, "Generate SBOM");

    assertEquals(
      asRecord(prepareSbom.env, "RC SBOM preparation environment").VERSION,
      "${{ steps.version.outputs.version }}",
    );
    assert(
      prereleaseSteps.indexOf(prepareSbom) <
        prereleaseSteps.indexOf(generateSbom),
      "The prerelease checkout must use the numbered RC version before SBOM generation",
    );
  });

  it("publishes a stable aggregate that fails for every non-success result", async () => {
    const jobs = await readJobs();
    const gate = asRecord(jobs["quality-gate-artifact"], "artifact gate");
    assertEquals(gate.name, "quality gate (artifact)");
    assertEquals(gate.needs, [
      "npm-compatibility-artifact",
      "tests-npm-install-smoke",
      "tests-runtime-critical-flow",
    ]);
    assertEquals(gate.if, "${{ always() }}");

    assertEquals((await runArtifactGate()).code, 0);
    for (const result of ["failure", "skipped", "cancelled"]) {
      for (
        const variable of [
          "ARTIFACT_BUILD_RESULT",
          "NPM_SMOKE_RESULT",
          "RUNTIME_CRITICAL_FLOW_RESULT",
        ]
      ) {
        const output = await runArtifactGate({ [variable]: result });
        assertEquals(
          output.code,
          1,
          `${variable}=${result} must fail the aggregate`,
        );
      }
    }
  });

  it("reports a reproducible five-to-one estimated build runner-minute comparison", async () => {
    const jobs = await readJobs();
    const runtime = asRecord(
      jobs["tests-runtime-critical-flow"],
      "runtime critical flow",
    );
    const runtimeStrategy = asRecord(runtime.strategy, "runtime critical flow strategy");
    const runtimeMatrix = asRecord(runtimeStrategy.matrix, "runtime critical flow matrix");
    const runtimes = runtimeMatrix.runtime;
    assert(Array.isArray(runtimes), "runtime critical flow matrix runtimes must be an array");
    assertEquals(runtimes.length, 3, "The runtime critical flow must have three consumers");
    assertEquals(
      NPM_SMOKE_NODE_VERSIONS.length,
      2,
      "The npm install smoke must have two Node consumers",
    );
    const estimatedConsumerCount = runtimes.length + NPM_SMOKE_NODE_VERSIONS.length;
    assertEquals(estimatedConsumerCount, 5);
    const gate = asRecord(jobs["quality-gate-artifact"], "artifact gate");
    const step = namedStep(gate, "Report npm build reuse");
    assertEquals(
      step.if,
      "${{ success() }}",
      "The build reuse report must not run after the aggregate dependency check fails",
    );
    assertEquals(
      asRecord(step.env, "npm build reuse environment"),
      {
        BUILD_DURATION_SECONDS:
          "${{ needs.npm-compatibility-artifact.outputs.build_duration_seconds }}",
        LEGACY_BUILD_COUNT: String(estimatedConsumerCount),
        CANONICAL_BUILD_COUNT: "1",
      },
    );
    const summary = await Deno.makeTempFile({ prefix: "vf-ci-cost-" });
    try {
      const result = await new Deno.Command("bash", {
        args: ["-c", String(step.run)],
        env: {
          GITHUB_STEP_SUMMARY: summary,
          BUILD_DURATION_SECONDS: "120",
          LEGACY_BUILD_COUNT: String(estimatedConsumerCount),
          CANONICAL_BUILD_COUNT: "1",
        },
      }).output();
      assertEquals(result.code, 0);
      const report = await Deno.readTextFile(summary);
      assertStringIncludes(
        report,
        "Estimate basis: five current npm build consumers (three runtime critical-flow jobs and two npm install-smoke jobs)",
      );
      assertStringIncludes(
        report,
        "Estimated before: 10.00 npm build runner-minutes",
      );
      assertStringIncludes(
        report,
        "Estimated after: 2.00 npm build runner-minutes",
      );
      assertStringIncludes(
        report,
        "Estimated savings: 8.00 npm build runner-minutes",
      );
    } finally {
      await Deno.remove(summary);
    }
  });
});
