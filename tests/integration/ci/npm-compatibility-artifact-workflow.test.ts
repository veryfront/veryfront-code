import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

type YamlRecord = Record<string, unknown>;

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/cicd.yml",
  import.meta.url,
);

const RESTORE_ACTION = "./.github/actions/restore-npm-workspace";

const RESTORE_ACTION_PATH = new URL(
  "../../../.github/actions/restore-npm-workspace/action.yml",
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
  it("builds once and uploads SHA-addressed package and runtime artifacts", async () => {
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
    const upload = steps.find((step) =>
      String(step.uses).startsWith("actions/upload-artifact@") &&
      asRecord(step.with, "artifact upload inputs").name ===
        "npm-compatibility-${{ github.sha }}"
    );
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
      asRecord(upload.with, "artifact upload inputs").overwrite,
      true,
      "Reruns must replace the SHA-addressed canonical artifact",
    );
    assertEquals(
      asRecord(upload.with, "artifact upload inputs")["retention-days"],
      30,
      "The tested npm artifact must remain available through production approval",
    );
    const archive = namedStep(producer, "Archive npm runtime workspace");
    assertStringIncludes(
      String(archive.run),
      "tar -cf - npm | gzip -1 > dist/npm-runtime-workspace.tar.gz",
    );
    const runtimeUpload = steps.find((step) =>
      String(step.uses).startsWith("actions/upload-artifact@") &&
      asRecord(step.with, "runtime artifact upload inputs").name ===
        "npm-runtime-workspace-${{ github.sha }}"
    );
    assert(runtimeUpload, "The producer must upload the built runtime workspace");
    assertEquals(
      asRecord(runtimeUpload.with, "runtime artifact upload inputs"),
      {
        name: "npm-runtime-workspace-${{ github.sha }}",
        path: "dist/npm-runtime-workspace.tar.gz",
        "retention-days": 1,
        "compression-level": 0,
        overwrite: true,
      },
    );
    assert(
      steps.indexOf(namedStep(producer, "Build and pack tested npm output")) <
          steps.indexOf(archive) &&
        steps.indexOf(archive) < steps.indexOf(runtimeUpload),
      "The producer must archive and upload the already-built runtime workspace",
    );
    const buildStep = namedStep(producer, "Build and pack tested npm output");
    const buildScript = String(buildStep.run);
    assertStringIncludes(
      buildScript,
      "--allow-run=npm,tar",
      "The producer must allow tar inspection when validating packed metadata",
    );
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
    assertEquals(
      smokeStep.run,
      "deno run -A scripts/test/npm-install-smoke.ts",
    );
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

  it("feeds the built runtime workspace to Node and Bun without rebuilding it", async () => {
    const jobs = await readJobs();

    // The download/extract/install sequence lives in the shared composite
    // action, so its contract is asserted once against the action itself.
    const action = asRecord(
      parse(await Deno.readTextFile(RESTORE_ACTION_PATH)),
      "restore-npm-workspace action",
    );
    const actionSteps = jobSteps(
      asRecord(action.runs, "restore-npm-workspace runs"),
      "restore-npm-workspace",
    );
    const download = actionSteps.find((step) =>
      String(step.uses).startsWith("actions/download-artifact@")
    );
    assert(download, "the action must download the built runtime workspace");
    assertEquals(
      asRecord(download.with, "action artifact download").name,
      "npm-runtime-workspace-${{ github.sha }}",
    );
    assertEquals(
      asRecord(download.with, "action artifact download").path,
      "dist/npm-runtime-workspace",
    );
    const restore = actionSteps.find((step) =>
      step.name === "Restore npm runtime workspace"
    );
    const install = actionSteps.find((step) =>
      step.name === "Materialize locked test dependencies"
    );
    assert(restore && install, "the action must restore and install");
    assertStringIncludes(
      String(restore.run),
      "tar -xzf dist/npm-runtime-workspace/npm-runtime-workspace.tar.gz",
    );
    assertEquals(install.run, "deno install --frozen");
    assert(
      actionSteps.indexOf(download) < actionSteps.indexOf(restore) &&
        actionSteps.indexOf(restore) < actionSteps.indexOf(install),
      "the action must download, restore, then materialize dependencies",
    );

    for (
      const [jobName, stepName, directCommand] of [
        [
          "tests-node",
          "Run Node runtime shard",
          "node ./tests/node/run-tests.mjs --suite=runtime:node",
        ],
        [
          "tests-bun",
          "Run Bun runtime suite",
          "node --test tests/bun/runner-args.test.mjs tests/bun/workspace-packages.test.mjs && node ./tests/bun/run-tests.mjs --suite=runtime:bun",
        ],
      ] as const
    ) {
      const job = asRecord(jobs[jobName], `${jobName} job`);
      assertEquals(job.needs, ["npm-compatibility-artifact"]);
      const steps = jobSteps(job, `${jobName} job`);
      const restoreUse = steps.find((step) => step.uses === RESTORE_ACTION);
      assert(
        restoreUse,
        `${jobName} must restore the runtime workspace via the shared action`,
      );
      const run = namedStep(job, stepName);
      assert(
        steps.indexOf(restoreUse) < steps.indexOf(run),
        `${jobName} must restore the runtime workspace before tests`,
      );
      assertEquals(run.run, directCommand);
      assertEquals(
        steps.filter((step) =>
          String(step.run).includes("deno task build:npm") ||
          String(step.run).includes("npm --prefix npm install")
        ).length,
        0,
        `${jobName} must not rebuild or reinstall the runtime workspace`,
      );
    }
  });

  it("runs two required Node shards without duplicating test files", async () => {
    const jobs = await readJobs();
    const node = asRecord(jobs["tests-node"], "Node sharding job");
    const strategy = asRecord(node.strategy, "Node sharding strategy");
    const matrix = asRecord(strategy.matrix, "Node sharding matrix");

    assertEquals(jobs["tests-node-sharded-shadow"], undefined);
    assertEquals(node["continue-on-error"], undefined);
    assertEquals(node.needs, ["npm-compatibility-artifact"]);
    assertEquals(node.name, "tests (node shard ${{ matrix.shard }}/2)");
    assertEquals(strategy["fail-fast"], false);
    assertEquals(matrix.shard, [1, 2]);
    assert(
      jobSteps(node, "Node sharding job").some((step) =>
        step.uses === RESTORE_ACTION
      ),
      "Node shards must restore the runtime workspace via the shared action",
    );
    const run = namedStep(node, "Run Node runtime shard");
    assertEquals(
      asRecord(run.env, "Node sharding environment").VF_TEST_SHARD,
      "${{ matrix.shard }}/2",
    );
    assertEquals(
      run.run,
      "node ./tests/node/run-tests.mjs --suite=runtime:node",
    );
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

});
