import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  CURRENT_NPM_SMOKE_NODE_RELEASE_LINE,
  MINIMUM_NODE_RELEASE_LINE,
  MINIMUM_NODE_VERSION,
  NPM_SMOKE_NODE_VERSIONS,
} from "./runtime-support.ts";

const WORKFLOW_PATH = new URL(
  "../../.github/workflows/cicd.yml",
  import.meta.url,
);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function steps(
  job: Record<string, unknown>,
  label: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(job.steps)) {
    throw new TypeError(`${label} steps must be an array`);
  }
  return job.steps.map((step, index) => record(step, `${label} step ${index}`));
}

describe("npm smoke Node support contract", () => {
  it("runs the packed npm smoke on the exact minimum and current release line", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "CI workflow",
    );
    const jobs = record(workflow.jobs, "CI workflow jobs");
    const versionsJob = record(
      jobs["npm-smoke-node-versions"],
      "npm smoke Node versions job",
    );
    const versionsStep = steps(versionsJob, "npm smoke Node versions job").find(
      (step) => step.id === "versions",
    );
    assert(
      versionsStep,
      "The version contract job must publish its Node matrix",
    );
    assertEquals(
      record(versionsJob.outputs, "npm smoke Node versions outputs")
        .node_versions,
      "${{ steps.versions.outputs.node_versions }}",
    );
    assertEquals(
      typeof versionsStep.run === "string" &&
        versionsStep.run.includes("NPM_SMOKE_NODE_VERSIONS"),
      true,
      "The workflow must derive the matrix from the runtime support module",
    );

    const smokeJob = record(
      jobs["tests-npm-install-smoke"],
      "npm install smoke job",
    );
    assertEquals(smokeJob.needs, [
      "npm-smoke-node-versions",
      "npm-compatibility-artifact",
    ]);
    assertEquals(
      record(
        record(smokeJob.strategy, "npm smoke strategy").matrix,
        "npm smoke matrix",
      )[
        "node-version"
      ],
      "${{ fromJSON(needs.npm-smoke-node-versions.outputs.node_versions) }}",
    );
    assertEquals(
      smokeJob.name,
      "tests (npm install smoke: Node ${{ matrix.node-version }})",
    );

    const smokeSteps = steps(smokeJob, "npm install smoke job");
    const setupNode = smokeSteps.find((step) =>
      step.uses ===
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"
    );
    assert(setupNode, "The npm smoke job must install its matrix Node release");
    assertEquals(
      record(setupNode.with, "npm smoke setup-node inputs")["node-version"],
      "${{ matrix.node-version }}",
    );
    assert(
      smokeSteps.some((step) =>
        step.name === "Clean-room install/import smoke" &&
        step.run === "deno run -A scripts/test/npm-install-smoke.ts"
      ),
      "Every matrix leg must run the existing packed clean-room smoke",
    );

    for (const jobName of ["prerelease", "release"]) {
      const releaseJob = record(jobs[jobName], `${jobName} job`);
      assert(
        Array.isArray(releaseJob.needs) &&
          releaseJob.needs.includes("quality-gate-artifact"),
        `${jobName} must wait for the npm artifact quality gate`,
      );
    }

    assertEquals(
      NPM_SMOKE_NODE_VERSIONS,
      [MINIMUM_NODE_VERSION, CURRENT_NPM_SMOKE_NODE_RELEASE_LINE],
    );
    assertEquals(MINIMUM_NODE_RELEASE_LINE, "22");
    assertEquals(MINIMUM_NODE_VERSION, "22.3.0");
    assertEquals(CURRENT_NPM_SMOKE_NODE_RELEASE_LINE, "24");
  });

  it("publishes the same numbered RC npm artifact that compatibility jobs test", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "CI workflow",
    );
    const jobs = record(workflow.jobs, "CI workflow jobs");

    const artifactJob = record(
      jobs["npm-compatibility-artifact"],
      "npm compatibility artifact job",
    );
    const artifactBuild = steps(
      artifactJob,
      "npm compatibility artifact job",
    ).find((step) => step.id === "build");
    assert(artifactBuild, "The npm artifact job must build the test artifact");
    const artifactBuildScript = String(artifactBuild.run);
    assert(
      artifactBuildScript.includes("scripts/ci/prepare-rc-build.ts"),
      "The tested npm artifact must inject the numbered RC version on main before packing",
    );
    assert(
      artifactBuildScript.includes(
        'VERSION="${BASE_VERSION}.${GITHUB_RUN_NUMBER}"',
      ),
      "The tested npm artifact must use the same numbered RC version as prerelease publish",
    );
    assert(
      artifactBuildScript.indexOf("scripts/ci/prepare-rc-build.ts") <
        artifactBuildScript.indexOf("deno task build:npm"),
      "The numbered RC version must be prepared before the npm artifact is built",
    );

    const prereleaseJob = record(jobs.prerelease, "prerelease job");
    assert(
      Array.isArray(prereleaseJob.needs) &&
        prereleaseJob.needs.includes("npm-compatibility-artifact"),
      "Prerelease publish must depend on the tested npm compatibility artifact",
    );
    const prereleaseSteps = steps(prereleaseJob, "prerelease job");
    assert(
      prereleaseSteps.some((step) =>
        step.uses ===
          "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c" &&
        record(step.with, "prerelease artifact download inputs").name ===
          "npm-compatibility-${{ github.sha }}" &&
        record(step.with, "prerelease artifact download inputs").path ===
          "dist/npm-compatibility"
      ),
      "Prerelease publish must download the npm artifact already tested by compatibility jobs",
    );
    const publishStep = prereleaseSteps.find((step) =>
      step.name === "Publish tested RC npm artifact"
    );
    assert(publishStep, "Prerelease publish must publish the tested artifact");
    const publishScript = String(publishStep.run);
    assert(
      publishScript.includes(
        "scripts/ci/npm-compatibility-artifact.ts materialize dist/npm-compatibility npm",
      ),
      "Prerelease publish must materialize the tested artifact before publishing",
    );
    assertEquals(
      publishScript.includes("deno task build:npm"),
      false,
      "Prerelease publish must not rebuild npm packages after compatibility testing",
    );
    assertEquals(
      publishScript.includes("scripts/ci/prepare-rc-build.ts"),
      false,
      "Prerelease publish must not mutate the RC version after compatibility testing",
    );
  });
});
