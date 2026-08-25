import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

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

function steps(job: YamlRecord, context: string): YamlRecord[] {
  assert(Array.isArray(job.steps), `${context} steps must be an array`);
  return job.steps.map((step) => asRecord(step, `${context} step`));
}

function namedStep(job: YamlRecord, name: string): YamlRecord {
  const step = steps(job, String(job.name)).find((step) => step.name === name);
  assert(step, `${String(job.name)} must include ${name}`);
  return step;
}

function tokenRepositories(job: YamlRecord): string[] {
  const tokenStep = namedStep(job, "Create release GitHub App token");
  const repositories = asRecord(tokenStep.with, "release token inputs").repositories;
  assert(typeof repositories === "string", "release token repositories must be a string");
  return repositories.trim().split("\n");
}

async function runReleaseDependencyGate(
  overrides: Record<string, string> = {},
): Promise<Deno.CommandOutput> {
  const jobs = await readJobs();
  const gate = asRecord(
    jobs["quality-gate-registry"],
    "registry quality gate job",
  );
  const step = namedStep(gate, "Require selected release publication");
  return await new Deno.Command("bash", {
    args: ["-c", String(step.run)],
    env: {
      IS_STABLE: "false",
      PRERELEASE_RESULT: "success",
      STABLE_RELEASE_RESULT: "skipped",
      ...overrides,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function runDispatchVersionResolution(
  overrides: Record<string, string>,
): Promise<Deno.CommandOutput> {
  const jobs = await readJobs();
  const dispatch = asRecord(jobs["dispatch-release"], "dispatch release job");
  const step = namedStep(dispatch, "Resolve published version");
  return await new Deno.Command("bash", {
    args: ["-c", String(step.run)],
    env: {
      GITHUB_OUTPUT: "/dev/null",
      IS_STABLE: "false",
      RC_VERSION: "0.1.2-rc.3",
      STABLE_VERSION: "0.1.2",
      ...overrides,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
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
        jobSteps.some((step) =>
          step.name ===
            (jobName === "prerelease"
              ? "Publish tested RC npm artifact"
              : "Publish tested stable npm artifact")
        ),
        `${jobName} must publish npm packages`,
      );
      const publishStep = namedStep(
        job,
        jobName === "prerelease"
          ? "Publish tested RC npm artifact"
          : "Publish tested stable npm artifact",
      );
      assertEquals(
        asRecord(publishStep.env, `${jobName} publish environment`).VERSION,
        "${{ steps.version.outputs.version }}",
        `${jobName} must pass the computed version to the publish script`,
      );
      assertEquals(
        jobSteps.filter((step) => String(step.uses).startsWith("peter-evans/repository-dispatch@"))
          .length,
        0,
      );
      if (jobName === "prerelease") {
        assertStringIncludes(
          String(namedStep(job, "Compute RC version").run),
          'BASE="${{ needs.version-check.outputs.version }}"',
          "prerelease must quote the base version assignment",
        );
      }
      assertEquals(
        tokenRepositories(job),
        ["veryfront"],
        `${jobName} release token must only access the release repository`,
      );
      assert(
        Array.isArray(job.needs) &&
          job.needs.includes("quality-gate-artifact"),
        `${jobName} must require the canonical artifact quality gate`,
      );
      if (jobName === "release") {
        assert(
          job.needs.includes("coverage"),
          "stable release must retain the coverage dependency",
        );
      }
    });
  }

  it("runs the exact-version registry smoke after the selected release", async () => {
    const jobs = await readJobs();
    const gate = asRecord(
      jobs["quality-gate-registry"],
      "registry quality gate job",
    );
    const gateSteps = steps(gate, "registry quality gate job");
    const registryStep = gateSteps.find((step) => step.name === "Validate exact registry release");

    assertEquals(gate.needs, ["prerelease", "release", "version-check"]);
    assertEquals(
      gateSteps[0]?.name,
      "Require selected release publication",
      "selected release dependency must be checked before checkout",
    );
    assert(
      gateSteps.findIndex((step) => String(step.uses).startsWith("actions/checkout@")) > 0,
      "registry checkout must follow the selected release dependency gate",
    );
    assertEquals(
      gate.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.version-check.result == 'success' && (needs.version-check.outputs.is_stable == 'false' || needs.version-check.outputs.stable_release_requested == 'true') }}",
      "registry gate must run only when prerelease or stable publication is requested",
    );
    assertEquals(
      asRecord(
        namedStep(gate, "Require selected release publication").env,
        "selected release dependency environment",
      ),
      {
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
        PRERELEASE_RESULT: "${{ needs.prerelease.result }}",
        STABLE_RELEASE_RESULT: "${{ needs.release.result }}",
      },
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

  it("may skip when no stable release is requested", async () => {
    const jobs = await readJobs();
    const gate = asRecord(
      jobs["quality-gate-registry"],
      "registry quality gate job",
    );
    const condition = String(gate.if);

    assert(
      condition.includes(
        "needs.version-check.outputs.is_stable == 'false' || needs.version-check.outputs.stable_release_requested == 'true'",
      ),
      condition,
    );
    assertEquals(
      condition.includes("needs.release.result == 'success'"),
      false,
    );
    assertEquals(
      condition.includes("needs.prerelease.result == 'success'"),
      false,
    );
  });

  it("fails closed for every non-success selected release result", async () => {
    for (const selectedResult of ["failure", "skipped", "cancelled"]) {
      for (const isStable of [false, true]) {
        const selectedName = isStable ? "STABLE_RELEASE_RESULT" : "PRERELEASE_RESULT";
        const output = await runReleaseDependencyGate({
          IS_STABLE: String(isStable),
          PRERELEASE_RESULT: isStable ? "skipped" : selectedResult,
          STABLE_RELEASE_RESULT: isStable ? selectedResult : "skipped",
        });
        const stderr = new TextDecoder().decode(output.stderr);

        assertEquals(
          output.code,
          1,
          `${selectedName}=${selectedResult} must fail the registry gate`,
        );
        assert(
          stderr.includes(`${selectedName} finished with ${selectedResult}`),
          stderr,
        );
      }
    }
  });

  it("dispatches exactly three downstream releases only after the registry gate", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["dispatch-release"], "dispatch release job");
    const dispatchSteps = steps(dispatch, "dispatch release job");
    const dispatchActions = dispatchSteps.filter((step) =>
      String(step.uses).startsWith("peter-evans/repository-dispatch@")
    );
    const versionStep = namedStep(dispatch, "Resolve published version");
    const tokenStep = namedStep(dispatch, "Create release GitHub App token");

    assertEquals(dispatch.needs, [
      "quality-gate-registry",
      "prerelease",
      "release",
      "version-check",
    ]);
    assertEquals(
      dispatch.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.quality-gate-registry.result == 'success' }}",
    );
    assertEquals(
      dispatch["timeout-minutes"],
      5,
      "release dispatch must time out if token creation or dispatch hangs",
    );
    assertEquals(versionStep.id, "version");
    assertEquals(
      asRecord(versionStep.env, "dispatch version environment"),
      {
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
        RC_VERSION: "${{ needs.prerelease.outputs.version }}",
        STABLE_VERSION: "${{ needs.release.outputs.version }}",
      },
    );
    assert(
      dispatchSteps.indexOf(versionStep) < dispatchSteps.indexOf(tokenStep),
      "published version must be resolved before the release token is created",
    );
    assertEquals(dispatchActions.length, 3);
    assertEquals(
      tokenRepositories(dispatch),
      [
        "veryfront-server",
        "veryfront-job-runner",
        "veryfront-sandbox",
      ],
      "dispatch release token must only access downstream release repositories",
    );
    assertEquals(
      dispatchActions.map((step) => asRecord(step.with, "repository dispatch inputs").repository),
      [
        "veryfront/veryfront-server",
        "veryfront/veryfront-job-runner",
        "veryfront/veryfront-sandbox",
      ],
    );
    for (const action of dispatchActions) {
      assertEquals(
        asRecord(action.with, "repository dispatch inputs")["client-payload"],
        '{"version": "${{ steps.version.outputs.version }}"}',
      );
    }

    for (
      const [isStable, expected] of [
        ["false", "version=0.1.2-rc.3"],
        ["true", "version=0.1.2"],
      ] as const
    ) {
      const outputFile = await Deno.makeTempFile({ prefix: "vf-release-version-" });
      try {
        const output = await runDispatchVersionResolution({
          GITHUB_OUTPUT: outputFile,
          IS_STABLE: isStable,
        });
        assertEquals(output.code, 0);
        assertStringIncludes(await Deno.readTextFile(outputFile), expected);
      } finally {
        await Deno.remove(outputFile);
      }
    }

    const missingSelectedVersions = [
      {
        IS_STABLE: "false",
        RC_VERSION: "",
        STABLE_VERSION: "0.1.2",
      },
      {
        IS_STABLE: "true",
        RC_VERSION: "0.1.2-rc.3",
        STABLE_VERSION: "",
      },
    ];
    for (const missingSelectedVersion of missingSelectedVersions) {
      const missingVersion = await runDispatchVersionResolution(
        missingSelectedVersion,
      );
      assertEquals(missingVersion.code, 1);
      const missingVersionOutput = new TextDecoder().decode(
        new Uint8Array([
          ...missingVersion.stdout,
          ...missingVersion.stderr,
        ]),
      );
      assertStringIncludes(
        missingVersionOutput,
        "Selected published version is empty",
      );
    }
  });

  it("documents the five-build estimate against the current npm build consumers", async () => {
    const jobs = await readJobs();
    const gate = asRecord(jobs["quality-gate-artifact"], "artifact gate");
    const report = namedStep(gate, "Report npm build reuse");

    assertEquals(
      asRecord(report.env, "npm build reuse environment").LEGACY_BUILD_COUNT,
      "5",
    );
    assertStringIncludes(
      String(report.run),
      "Estimate basis: five current npm build consumers (three runtime critical-flow jobs and two npm install-smoke jobs)",
    );
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
