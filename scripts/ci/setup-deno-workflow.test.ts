import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

const ACTION_PATH = ".github/actions/setup-deno/action.yml";
const WORKFLOWS_DIR = ".github/workflows";
const LOCAL_ACTION = "./.github/actions/setup-deno";
const CACHE_RESTORE_ACTION =
  "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const CACHE_SAVE_ACTION =
  "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const MAX_SETUP_MINUTES = 5;
const MAX_CACHE_SETUP_MINUTES = 10;
const CACHE_PRODUCER_JOB = "tests";
const CHROMIUM_STEP_MINUTES = 15;
const CHROMIUM_OVERHEAD_MARGIN_SECONDS = 120;

type YamlRecord = Record<string, unknown>;

function asRecord(value: unknown, context: string): YamlRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as YamlRecord;
}

function asSteps(value: unknown, context: string): YamlRecord[] {
  assert(Array.isArray(value), `${context} must be an array`);
  return value.map((step, index) => asRecord(step, `${context}[${index}]`));
}

function isReusableWorkflowCall(value: unknown): value is string {
  return typeof value === "string" &&
    (/^\.\/\.github\/workflows\/[^/]+\.ya?ml$/.test(value) ||
      /^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^/@\s]+\.ya?ml@[^@\s]+$/.test(
        value,
      ));
}

function stepsForSetupScan(job: YamlRecord, context: string): YamlRecord[] {
  if (job.steps === undefined && isReusableWorkflowCall(job.uses)) return [];
  return asSteps(job.steps, `${context}.steps`);
}

function shellInteger(script: string, name: string): number {
  const match = script.match(new RegExp(`^\\s*readonly ${name}=(\\d+)$`, "m"));
  assert(match, `Chromium installer must declare ${name}`);
  return Number(match[1]);
}

async function parseYamlFile(path: string): Promise<YamlRecord> {
  return asRecord(parse(await Deno.readTextFile(path)), path);
}

async function withWorkflowFile(
  name: string,
  content: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const path = `${WORKFLOWS_DIR}/${name}`;
  await Deno.writeTextFile(path, content);
  try {
    await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

async function workflowPathsUsingSetupDeno(): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    const path = `${WORKFLOWS_DIR}/${entry.name}`;
    const workflow = await parseYamlFile(path);
    const jobs = asRecord(workflow.jobs, `${path}.jobs`);
    const usesSetupDeno = Object.entries(jobs).some(([jobName, value]) => {
      const job = asRecord(value, `${path}.jobs.${jobName}`);
      return stepsForSetupScan(job, `${path}.jobs.${jobName}`).some((step) =>
        step.uses === LOCAL_ACTION
      );
    });
    if (usesSetupDeno) {
      paths.push(path);
    }
  }
  return paths.sort();
}

describe("setup-deno CI contract", () => {
  it("skips only valid reusable-workflow jobs without steps", () => {
    assertEquals(
      stepsForSetupScan(
        { uses: "./.github/workflows/reusable.yml" },
        "local reusable job",
      ),
      [],
    );
    assertEquals(
      stepsForSetupScan(
        {
          uses: "veryfront/veryfront-code/.github/workflows/reusable.yml@main",
        },
        "owner reusable job",
      ),
      [],
    );
    assertThrows(
      () => stepsForSetupScan({ "runs-on": "ubuntu-latest" }, "ordinary job"),
      Error,
      "ordinary job.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "actions/checkout@v7" },
          "invalid job-level action",
        ),
      Error,
      "invalid job-level action.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "./.github/workflows/nested/reusable.yml" },
          "invalid local reusable job",
        ),
      Error,
      "invalid local reusable job.steps must be an array",
    );
    assertThrows(
      () =>
        stepsForSetupScan(
          { uses: "./.github/workflows/reusable.yml", steps: "invalid" },
          "malformed reusable job",
        ),
      Error,
      "malformed reusable job.steps must be an array",
    );
  });

  it("uses a pinned cache and bounded, frozen dependency warming", async () => {
    const action = await parseYamlFile(ACTION_PATH);
    const runs = asRecord(action.runs, `${ACTION_PATH}.runs`);
    const steps = asSteps(runs.steps, `${ACTION_PATH}.runs.steps`);

    const cacheStep = steps.find((step) => step.uses === CACHE_RESTORE_ACTION);
    assert(
      cacheStep,
      "setup-deno must use the pinned restore-only cache action",
    );
    const cacheEnv = asRecord(cacheStep.env, "cache step env");
    assertEquals(cacheEnv.SEGMENT_DOWNLOAD_TIMEOUT_MINS, "2");
    const cacheInputs = asRecord(cacheStep.with, "cache step inputs");
    const cacheKey = String(cacheInputs.key);
    assertStringIncludes(cacheKey, "${{ runner.os }}");
    assertStringIncludes(cacheKey, "${{ runner.arch }}");
    assertStringIncludes(cacheKey, "2.7.7");
    assertStringIncludes(cacheKey, "veryfront-deno-v2-");
    for (
      const dependencyInput of [
        "'deno.lock'",
        "'scripts/deno.lock'",
        "'deno.json'",
        "'**/deno.json'",
      ]
    ) {
      assertStringIncludes(cacheKey, dependencyInput);
    }
    assertStringIncludes(String(cacheInputs.path), "runner.temp");

    const saveStep = steps.find((step) => step.uses === CACHE_SAVE_ACTION);
    assert(saveStep, "setup-deno must use the pinned save-only cache action");
    assertEquals(
      String(saveStep.if),
      "inputs.warm-cache == 'true' && inputs.warm-redis-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
    );
    const saveInputs = asRecord(saveStep.with, "cache save inputs");
    assertEquals(
      saveInputs.key,
      "${{ steps.deno-cache.outputs.cache-primary-key }}",
    );

    const installStep = steps.find((step) =>
      step.name === "Install pinned Deno"
    );
    assert(installStep, "setup-deno must install Deno explicitly");
    const install = String(installStep.run);
    assertStringIncludes(install, 'version="2.7.7"');
    assertStringIncludes(install, "--retry-max-time 120");
    assertStringIncludes(install, "--remove-on-error");
    assertMatch(install, /--connect-timeout\s+20\s+--max-time\s+120/);
    assertStringIncludes(
      install,
      "https://github.com/denoland/deno/releases/download/v${version}/${archive}.sha256sum",
    );
    assertStringIncludes(
      install,
      "https://github.com/denoland/deno/releases/download/v${version}/checksums.txt",
    );
    assertStringIncludes(
      install,
      'checksum_parse_path="${checksums_manifest_path}"',
    );
    assertStringIncludes(
      install,
      'checksums_manifest_actual_sha256="$(sha256sum "${checksums_manifest_path}" | awk',
    );
    assertStringIncludes(
      install,
      'checksums_manifest_actual_sha256="$(shasum -a 256 "${checksums_manifest_path}" | awk',
    );
    assertStringIncludes(
      install,
      'checksums_manifest_actual_sha256="$(openssl dgst -sha256 "${checksums_manifest_path}" | awk',
    );
    assertStringIncludes(
      install,
      'checksums_manifest_actual_sha256="$(node -e "const fs = require(\'fs\'); const crypto = require(\'crypto\'); process.stdout.write(crypto.createHash(\'sha256\').update(fs.readFileSync(process.argv[1])).digest(\'hex\')" "${checksums_manifest_path}")"',
    );
    assertStringIncludes(
      install,
      'if [ "${checksums_manifest_actual_sha256}" != "${checksums_manifest_sha256}" ]',
    );
    assertStringIncludes(
      install,
      'archive_sha256="$(awk \'BEGIN {IGNORECASE = 1} /^Hash[[:space:]]*:/ { print tolower($3) }\' "${checksum_parse_path}")"',
    );
    assertStringIncludes(
      install,
      'archive_sha256="$(awk -v target="${archive}" \'$2 == target || $2 == "\*" target { print tolower($1) }\' "${checksum_parse_path}")"',
    );
    assertStringIncludes(
      install,
      'if [ "${actual_sha256}" != "${archive_sha256}" ]',
    );
    assertStringIncludes(
      install,
      'if [ -z "${archive_sha256}" ]; then',
    );
    assertEquals(
      /\bnpm\b/.test(install),
      false,
      "the installer must not fall back to npm",
    );

    const redisWarm = steps.find((step) =>
      step.name === "Warm Redis module cache"
    );
    const dependencyWarm = steps.find((step) =>
      step.name === "Warm esm.sh cache"
    );
    assert(redisWarm && dependencyWarm, "both warm-cache steps must exist");

    for (
      const [name, step, deadline, expectedCondition] of [
        [
          "Redis",
          redisWarm,
          "2m",
          "inputs.warm-redis-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
        ],
        [
          "dependency",
          dependencyWarm,
          "3m",
          "inputs.warm-cache == 'true' && steps.deno-cache.outputs.cache-hit != 'true'",
        ],
      ] as const
    ) {
      const condition = String(step.if);
      const command = String(step.run);
      assertEquals(condition, expectedCondition);
      assertMatch(
        command,
        new RegExp(`timeout[^\\n]+${deadline}`),
        `${name} warming must have a process deadline`,
      );
      assertStringIncludes(command, "deno cache --frozen");
      assertEquals(command.includes("--reload"), false);
      assertEquals(command.includes("|| true"), false);
    }
  });

  it("discovers setup-deno callers through parsed workflow YAML", async () => {
    await withWorkflowFile(
      "zz-setup-deno-quoted.test.yml",
      `
name: quoted setup-deno contract
jobs:
  quoted:
    if: \${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    steps:
      - uses: "./.github/actions/setup-deno"
        timeout-minutes: 5
`,
      async (path) => {
        const workflowPaths = await workflowPathsUsingSetupDeno();
        assert(
          workflowPaths.includes(path),
          "quoted setup-deno callers must be discovered from parsed YAML",
        );
      },
    );
  });

  it("uses one complete cache producer, caps setup, and excludes fork PRs", async () => {
    const workflowPaths = await workflowPathsUsingSetupDeno();
    assert(
      workflowPaths.length > 0,
      "at least one workflow must use setup-deno",
    );

    let setupCalls = 0;
    let cacheProducerCalls = 0;
    for (const path of workflowPaths) {
      const workflow = await parseYamlFile(path);
      const jobs = asRecord(workflow.jobs, `${path}.jobs`);
      for (const [jobName, value] of Object.entries(jobs)) {
        const job = asRecord(value, `${path}.jobs.${jobName}`);
        const steps = stepsForSetupScan(job, `${path}.jobs.${jobName}`);
        const setupSteps = steps.filter((step) => step.uses === LOCAL_ACTION);
        for (const step of setupSteps) {
          setupCalls++;
          const inputs = asRecord(step.with ?? {}, "setup inputs");
          // Only the job that warms BOTH the dependency graph and the Redis
          // cache is the complete cache producer; other jobs may warm the
          // dependency cache alone as consumers.
          const isCompleteCacheProducer = inputs["warm-cache"] === "true" &&
            inputs["warm-redis-cache"] === "true";

          if (isCompleteCacheProducer) {
            cacheProducerCalls++;
            assertEquals(path, `${WORKFLOWS_DIR}/cicd.yml`);
            assertEquals(jobName, CACHE_PRODUCER_JOB);
          }

          assertEquals(
            step["timeout-minutes"],
            isCompleteCacheProducer
              ? MAX_CACHE_SETUP_MINUTES
              : MAX_SETUP_MINUTES,
            `${path} ${jobName} setup-deno must leave time for job work`,
          );
          if (isCompleteCacheProducer) {
            assertEquals(
              job["runs-on"],
              "ubuntu-latest",
              `${path} ${jobName} uses the Linux timeout command while warming`,
            );
          }
        }

        if (setupSteps.length > 0) {
          assertStringIncludes(
            String(job.if),
            "github.event.pull_request.head.repo.full_name == github.repository",
            `${path} ${jobName} must not run repository code or save caches for fork PRs`,
          );
        }
      }
    }

    assert(setupCalls > 0, "setup-deno workflow calls must be inspected");
    assertEquals(
      cacheProducerCalls,
      1,
      "exactly one job may pre-warm and save the complete dependency graph",
    );

    const ci = await parseYamlFile(`${WORKFLOWS_DIR}/cicd.yml`);
    const ciJob = asRecord(asRecord(ci.jobs, "cicd jobs").ci, "ci job");
    const ciRunStep = asSteps(ciJob.steps, "ci steps").find((step) =>
      step.name === "Run ${{ matrix.check }}"
    );
    assert(ciRunStep, "ci matrix job must run the requested check");
    assertStringIncludes(
      String(ciRunStep.run),
      "--allow-read --allow-write scripts/ci/setup-deno-workflow.test.ts",
      "required lint shard must allow temporary workflow fixtures",
    );

    const coverageShards = asRecord(
      asRecord(ci.jobs, "cicd jobs")["coverage-shards"],
      "coverage-shards job",
    );
    assertEquals(coverageShards["timeout-minutes"], 15);
    const coverageSetup = asSteps(
      coverageShards.steps,
      "coverage-shards steps",
    ).find((step) => step.uses === LOCAL_ACTION);
    assert(coverageSetup, "coverage shards must use setup-deno");
    assertEquals(coverageSetup["timeout-minutes"], MAX_SETUP_MINUTES);

    for (const jobName of ["tests-e2e-rsc-browser", "tests-binary-e2e"]) {
      const job = asRecord(
        asRecord(ci.jobs, "cicd jobs")[jobName],
        jobName,
      );
      const chromiumInstall = asSteps(job.steps, `${jobName} steps`).find(
        (step) => step.name === "Install Chromium",
      );
      assert(chromiumInstall, `${jobName} must install Chromium`);
      assertEquals(
        chromiumInstall["timeout-minutes"],
        CHROMIUM_STEP_MINUTES,
        `${jobName} Chromium provisioning needs a total step deadline`,
      );
      const install = String(chromiumInstall.run);
      for (
        const expected of [
          'for attempt in $(seq 1 "${install_attempts}")',
          '--kill-after="${install_kill_grace_seconds}s" "${install_timeout_minutes}m"',
          'for _ in $(seq 1 "${apt_lock_attempts}")',
          'sleep "${apt_lock_sleep_seconds}"',
          'sleep "${retry_backoff_seconds}"',
        ]
      ) {
        assertStringIncludes(install, expected);
      }
      assertEquals(install.includes("apt-get clean"), false);
      assertEquals(install.includes("rm -rf /var/lib/apt/lists"), false);

      const attempts = shellInteger(install, "install_attempts");
      const installSeconds = shellInteger(
        install,
        "install_timeout_minutes",
      ) * 60;
      const installKillGrace = shellInteger(
        install,
        "install_kill_grace_seconds",
      );
      const aptLockSeconds = shellInteger(install, "apt_lock_attempts") *
        shellInteger(install, "apt_lock_sleep_seconds");
      const backoffSeconds = shellInteger(install, "retry_backoff_seconds");
      const worstCaseSeconds = attempts *
          (aptLockSeconds + installSeconds + installKillGrace) +
        (attempts - 1) * backoffSeconds;
      assert(
        worstCaseSeconds <=
          CHROMIUM_STEP_MINUTES * 60 - CHROMIUM_OVERHEAD_MARGIN_SECONDS,
        `${jobName} Chromium retries need at least ${CHROMIUM_OVERHEAD_MARGIN_SECONDS}s of outer-step overhead margin; budget is ${worstCaseSeconds}s`,
      );
    }
  });
});
