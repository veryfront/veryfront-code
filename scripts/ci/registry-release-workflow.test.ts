import { assert, assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL(
  "../../.github/workflows/cicd.yml",
  import.meta.url,
);

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

function steps(job: YamlRecord, context: string): YamlRecord[] {
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

describe("registry release workflow", () => {
  for (const jobName of ["prerelease", "release"] as const) {
    it(`exposes the published version without dispatching inside ${jobName}`, async () => {
      const jobs = await readJobs();
      const job = asRecord(jobs[jobName], `${jobName} job`);
      const jobSteps = steps(job, `${jobName} job`);

      assertEquals(
        asRecord(job.outputs, `${jobName} outputs`).version,
        "${{ steps.version.outputs.version }}",
      );
      assert(
        jobSteps.some((step) => step.name === "Build and publish"),
        `${jobName} must publish npm packages`,
      );
      assertEquals(
        jobSteps.filter((step) =>
          String(step.uses).startsWith("peter-evans/repository-dispatch@")
        ).length,
        0,
      );
    });
  }

  it("runs the exact-version registry smoke after the selected release", async () => {
    const jobs = await readJobs();
    const gate = asRecord(
      jobs["quality-gate-registry"],
      "registry quality gate job",
    );
    const gateSteps = steps(gate, "registry quality gate job");
    const registryStep = gateSteps.find((step) =>
      step.name === "Validate exact registry release"
    );

    assertEquals(gate.needs, ["prerelease", "release", "version-check"]);
    assertEquals(
      gate.if,
      "${{ always() && needs.version-check.result == 'success' && ((needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success') || (needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success')) }}",
    );
    assert(registryStep, "registry quality gate must run the smoke script");
    assertEquals(
      registryStep.run,
      "bash scripts/ci/registry-release-smoke.sh",
    );
    assertEquals(
      asRecord(registryStep.env, "registry quality gate environment"),
      {
        RC_VERSION: "${{ needs.prerelease.outputs.version }}",
        STABLE_VERSION: "${{ needs.release.outputs.version }}",
        GITHUB_SHA: "${{ github.sha }}",
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
      },
    );
  });

  it("dispatches exactly three downstream releases only after the registry gate", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["dispatch-release"], "dispatch release job");
    const dispatchSteps = steps(dispatch, "dispatch release job");
    const dispatchActions = dispatchSteps.filter((step) =>
      String(step.uses).startsWith("peter-evans/repository-dispatch@")
    );

    assertEquals(dispatch.needs, [
      "quality-gate-registry",
      "prerelease",
      "release",
      "version-check",
    ]);
    assertEquals(
      dispatch.if,
      "${{ always() && needs.quality-gate-registry.result == 'success' }}",
    );
    assertEquals(dispatchActions.length, 3);
    assertEquals(
      dispatchActions.map((step) =>
        asRecord(step.with, "repository dispatch inputs").repository
      ),
      [
        "veryfront/veryfront-server",
        "veryfront/veryfront-job-runner",
        "veryfront/veryfront-sandbox",
      ],
    );
    for (const action of dispatchActions) {
      assertEquals(
        asRecord(action.with, "repository dispatch inputs")["client-payload"],
        '{"version": "${{ needs.version-check.outputs.is_stable == \'true\' && needs.release.outputs.version || needs.prerelease.outputs.version }}"}',
      );
    }
  });

  it("keeps stable production approval and publishing in the release job", async () => {
    const jobs = await readJobs();
    const release = asRecord(jobs.release, "stable release job");

    assertEquals(release.environment, "production");
    assert(
      steps(release, "stable release job").some((step) =>
        String(step.run).includes("release-publish")
      ),
      "stable release job must still publish npm packages",
    );
  });
});
