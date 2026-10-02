import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl } from "#std/path";
import { parse } from "#std/yaml/parse";
import {
  readPropagationBudget,
  REQUEST_TIMEOUT_MS,
} from "../../../scripts/ci/registry-release-integrity.ts";
import { DEFAULT_SMOKE_BUDGET_MS } from "../../../scripts/test/npm-install-smoke.ts";

type YamlRecord = Record<string, unknown>;
const MERGE_CORRECTNESS_DEPENDENCIES = [
  "ci",
  "coverage",
  "tests",
  "tests-node",
  "tests-bun",
  "tests-binary-e2e",
  "tests-e2e-rsc-browser",
] as const;

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/cicd.yml",
  import.meta.url,
);
const RELEASE_SCRIPT_PATH = fromFileUrl(
  new URL("../../../scripts/ci/publish-github-release.sh", import.meta.url),
);
const decoder = new TextDecoder();

/**
 * What `scripts/test/npm-install-smoke.ts` may spend after the poll returns.
 *
 * Its own step timeouts do not bound it -- a registry install retries
 * propagation skew five times at ten minutes each, and it runs two of them --
 * so the smoke enforces this budget on itself and caps every command at what
 * is left of it. That makes the number here the smoke's real ceiling rather
 * than a guess at its typical two to five minutes, which is what the job has
 * to hold: the poll only spends its own budget on the runs where npm is
 * slowest, and those are the runs where the smoke has least room.
 */
const SMOKE_ALLOWANCE_MS = DEFAULT_SMOKE_BUDGET_MS;

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
  assert(
    typeof repositories === "string",
    "release token repositories must be a string",
  );
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
  const step = namedStep(gate, "Report selected release result");
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

async function runVersionValidation(version: string): Promise<Deno.CommandOutput> {
  const jobs = await readJobs();
  const versionCheck = asRecord(jobs["version-check"], "version check job");
  const detect = namedStep(versionCheck, "Detect release type");
  const run = String(detect.run);
  const match = run.match(/if ! \[\[ "\$VERSION" =~ (.+) \]\]; then/);

  assert(match?.[1], "version-check must expose its validation regex");
  return await new Deno.Command("bash", {
    args: ["-c", `[[ "$VERSION" =~ ${match[1]} ]]`],
    env: { VERSION: version },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

type ReleaseState = "missing" | "draft" | "published";
type CreateFailure = "none" | "after-creation";
type UploadFailureStatus = 1 | 64;

async function runReleaseScript({
  stateDir,
  asset,
  initialReleaseState = "missing",
  createFailure = "none",
  failedUploadAttempts = 0,
  uploadFailureStatus = 1,
  failedPublishAttempts = 0,
}: {
  stateDir: string;
  asset: string;
  initialReleaseState?: ReleaseState;
  createFailure?: CreateFailure;
  failedUploadAttempts?: number;
  uploadFailureStatus?: UploadFailureStatus;
  failedPublishAttempts?: number;
}): Promise<Deno.CommandOutput> {
  const ghLog = `${stateDir}/gh.log`;
  const uploadCount = `${stateDir}/upload-count`;
  const publishCount = `${stateDir}/publish-count`;
  const releaseState = `${stateDir}/release-state`;
  await Deno.writeTextFile(ghLog, "");
  await Deno.writeTextFile(uploadCount, "0");
  await Deno.writeTextFile(publishCount, "0");
  await Deno.writeTextFile(releaseState, initialReleaseState);

  return await new Deno.Command("bash", {
    args: [
      "-c",
      [
        "set -euo pipefail",
        'release_script="$1"',
        'asset="$2"',
        "gh() {",
        '  printf "%s\\n" "$*" >> "$GH_LOG"',
        '  if [ "$1" = "release" ] && [ "$2" = "view" ]; then',
        '    case "$(cat "$RELEASE_STATE")" in',
        "      missing) return 1 ;;",
        '      draft) printf "true\\n" ;;',
        '      published) printf "false\\n" ;;',
        "    esac",
        "    return 0",
        "  fi",
        '  if [ "$1" = "release" ] && [ "$2" = "create" ]; then',
        '    if [ "$(cat "$RELEASE_STATE")" != "missing" ]; then',
        "      return 1",
        "    fi",
        '    printf "draft" > "$RELEASE_STATE"',
        '    if [ "$CREATE_FAILURE" = "after-creation" ]; then',
        "      return 1",
        "    fi",
        "  fi",
        '  if [ "$1" = "release" ] && [ "$2" = "upload" ]; then',
        '    count="$(cat "$UPLOAD_COUNT")"',
        "    count=$((count + 1))",
        '    printf "%s" "$count" > "$UPLOAD_COUNT"',
        '    if [ "$count" -le "$FAILED_UPLOAD_ATTEMPTS" ]; then',
        '      return "$UPLOAD_FAILURE_STATUS"',
        "    fi",
        "  fi",
        '  if [ "$1" = "release" ] && [ "$2" = "edit" ]; then',
        '    count="$(cat "$PUBLISH_COUNT")"',
        "    count=$((count + 1))",
        '    printf "%s" "$count" > "$PUBLISH_COUNT"',
        '    if [ "$count" -le "$FAILED_PUBLISH_ATTEMPTS" ]; then',
        "      return 1",
        "    fi",
        '    printf "published" > "$RELEASE_STATE"',
        "  fi",
        '  if [ "$1" = "release" ] && [ "$2" = "delete" ]; then',
        '    printf "missing" > "$RELEASE_STATE"',
        "  fi",
        "}",
        "sleep() { :; }",
        "export -f gh sleep",
        'exec bash "$release_script" \\',
        '  --repo "veryfront/veryfront" \\',
        '  --tag "v1.2.3-rc.4" \\',
        '  --title "v1.2.3-rc.4" \\',
        '  --notes "Install notes" \\',
        "  --prerelease \\",
        "  -- \\",
        '  "$asset"',
      ].join("\n"),
      "release-script-test",
      RELEASE_SCRIPT_PATH,
      asset,
    ],
    env: {
      GH_LOG: ghLog,
      UPLOAD_COUNT: uploadCount,
      PUBLISH_COUNT: publishCount,
      RELEASE_STATE: releaseState,
      CREATE_FAILURE: createFailure,
      FAILED_UPLOAD_ATTEMPTS: String(failedUploadAttempts),
      UPLOAD_FAILURE_STATUS: String(uploadFailureStatus),
      FAILED_PUBLISH_ATTEMPTS: String(failedPublishAttempts),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

describe("registry release workflow", () => {
  it("publishes stable assets while preserving a previously published RC and its tag", async () => {
    const jobs = await readJobs();
    const step = namedStep(asRecord(jobs.release, "release job"), "Create GitHub releases");
    await withTempDir(async (stateDir) => {
      for (const path of ["bin", "releases", "scripts/ci", "binaries/veryfront-linux-x64"]) {
        await Deno.mkdir(`${stateDir}/${path}`, { recursive: true });
      }
      await Deno.copyFile(RELEASE_SCRIPT_PATH, `${stateDir}/scripts/ci/publish-github-release.sh`);
      for (
        const asset of [
          "scripts/install.sh",
          "scripts/install.ps1",
          "binaries/veryfront-linux-x64/veryfront-linux-x64",
        ]
      ) {
        await Deno.writeTextFile(`${stateDir}/${asset}`, "synthetic release asset");
      }
      const retainedRelease = `${stateDir}/releases/v1.2.3-rc.4`;
      await Deno.writeTextFile(retainedRelease, "published RC assets and tag");
      await Deno.writeTextFile(
        `${stateDir}/bin/gh`,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STATE_DIR/gh.log"
case "$1:$2" in
  release:list) printf 'v1.2.3-rc.4\n' ;;
  release:view)
    [ -f "$STATE_DIR/releases/$3" ] || exit 1
    if [ "$(cat "$STATE_DIR/releases/$3")" = draft ]; then echo true; else echo false; fi ;;
  release:create) printf draft > "$STATE_DIR/releases/$3" ;;
  release:upload) [ -f "$4" ] ;;
  release:edit) printf published > "$STATE_DIR/releases/$3" ;;
  release:delete) rm -f "$STATE_DIR/releases/$3" ;;
  *) exit 1 ;;
esac
`,
      );
      await Deno.writeTextFile(
        `${stateDir}/bin/sha256sum`,
        `#!/usr/bin/env bash
printf '%064d  %s\n' 0 "$1"
`,
      );
      await Deno.chmod(`${stateDir}/bin/gh`, 0o755);
      await Deno.chmod(`${stateDir}/bin/sha256sum`, 0o755);
      const output = await new Deno.Command("bash", {
        args: ["-eo", "pipefail", "-c", String(step.run)],
        cwd: stateDir,
        env: {
          PATH: `${stateDir}/bin:${Deno.env.get("PATH")}`,
          STATE_DIR: stateDir,
          VERSION: "1.2.3",
          GH_TOKEN: "synthetic",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(await Deno.readTextFile(`${stateDir}/releases/v1.2.3`), "published");
      assertEquals(await Deno.readTextFile(retainedRelease), "published RC assets and tag");
      assertStringIncludes(
        await Deno.readTextFile(`${stateDir}/gh.log`),
        "--prerelease=false --latest",
      );
    });
  });

  it("publishes after retrying a transient release asset upload failure", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        failedUploadAttempts: 1,
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        2,
        "the failed asset must be retried",
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release edit ")).length,
        1,
        "the draft must be published once after every asset upload succeeds",
      );
    });
  });

  it("removes an incomplete release after upload retries are exhausted", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        failedUploadAttempts: 3,
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 1);
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        3,
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release edit ")).length,
        0,
        "an incomplete draft must never be published",
      );
      assert(
        ghCalls.at(-1)?.startsWith("release delete v1.2.3-rc.4 "),
        "the incomplete release must be deleted after the final failed upload",
      );
    });
  });

  it("retries upload failures that match the internal fatal status", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        failedUploadAttempts: 1,
        uploadFailureStatus: 64,
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        2,
        "external upload statuses must not use the create-only fatal sentinel",
      );
    });
  });

  it("preserves an existing published release", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        initialReleaseState: "published",
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 1);
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release view ")).length,
        1,
        "a published-release conflict must fail without retries",
      );
      assertEquals(
        decoder.decode(output.stderr).includes("Retrying"),
        false,
        "a published-release conflict must not report a transient retry",
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release create ")).length,
        0,
        "an existing published release must not be recreated",
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        0,
        "an existing published release must not accept new assets",
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release delete ")).length,
        0,
        "draft creation failure must not delete a release that predates this run",
      );
    });
  });

  it("recovers when draft creation succeeds remotely but reports failure", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        createFailure: "after-creation",
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release create ")).length,
        1,
        "the remotely created draft must be adopted instead of recreated",
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        1,
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release edit ")).length,
        1,
        "the adopted draft must be published after its assets upload",
      );
    });
  });

  it("preserves a fully uploaded draft when publication retries are exhausted", async () => {
    await withTempDir(async (stateDir) => {
      const asset = `${stateDir}/veryfront-macos-arm64`;
      await Deno.writeTextFile(asset, "binary");

      const output = await runReleaseScript({
        stateDir,
        asset,
        failedPublishAttempts: 3,
      });
      const ghCalls = (await Deno.readTextFile(`${stateDir}/gh.log`))
        .trim()
        .split("\n");

      assertEquals(output.code, 1);
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release upload ")).length,
        1,
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release edit ")).length,
        3,
      );
      assertEquals(
        ghCalls.filter((call) => call.startsWith("release delete ")).length,
        0,
        "publication failure must retain the uploaded draft for recovery",
      );
    });
  });

  it("routes public GitHub releases through the retrying asset publisher", async () => {
    const jobs = await readJobs();
    for (
      const [jobName, stepName] of [
        ["github-prerelease", "Create GitHub pre-release"],
        ["release", "Create GitHub releases"],
      ] as const
    ) {
      const job = asRecord(jobs[jobName], `${jobName} job`);
      const releaseStep = namedStep(job, stepName);
      const run = String(releaseStep.run);

      assertStringIncludes(
        run,
        "bash scripts/ci/publish-github-release.sh",
        `${jobName} must use the retrying release asset publisher`,
      );
      assertEquals(
        run.includes("gh release create"),
        false,
        `${jobName} must not bypass per-asset retries`,
      );
    }
  });

  it("validates the deno.json version before exposing release outputs", async () => {
    const jobs = await readJobs();
    const versionCheck = asRecord(jobs["version-check"], "version check job");
    const detect = namedStep(versionCheck, "Detect release type");
    const run = String(detect.run);
    const validationIndex = run.indexOf('if ! [[ "$VERSION" =~');
    const outputIndex = run.indexOf('echo "version=${VERSION}"');

    assert(
      validationIndex >= 0,
      "version-check must validate a safe npm version",
    );
    assertStringIncludes(
      run,
      "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)",
      "version-check must reject leading zeroes in numeric semver components",
    );
    assertStringIncludes(
      run,
      "(-((0|[1-9][0-9]*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(\\.((0|[1-9][0-9]*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?",
      "version-check must reject leading zeroes only in numeric prerelease identifiers",
    );
    assert(
      validationIndex < outputIndex,
      "version-check must validate the version before writing GITHUB_OUTPUT",
    );
  });

  it("enforces numeric prerelease identifiers without rejecting alphanumeric identifiers", async () => {
    for (
      const version of [
        "1.2.3",
        "1.2.3-rc.0",
        "1.2.3-rc.1",
        "1.2.3-0rc",
        "1.2.3-01rc",
        "1.2.3-rc-01",
      ]
    ) {
      const output = await runVersionValidation(version);
      assertEquals(output.code, 0, `${version} must be accepted`);
    }

    for (const version of ["1.2.3-01", "1.2.3-rc.01"]) {
      const output = await runVersionValidation(version);
      assertEquals(output.code, 1, `${version} must be rejected`);
    }
  });

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
      const npmPinStep = namedStep(job, "Pin npm CLI for publication");
      assertEquals(
        asRecord(npmPinStep.env, `${jobName} npm pin environment`),
        { NPM_CLI_VERSION: "11.12.1" },
      );
      assertEquals(
        npmPinStep.run,
        'npm install --global "npm@${NPM_CLI_VERSION}"',
      );
      assert(
        jobSteps.indexOf(npmPinStep) < jobSteps.indexOf(publishStep),
        `${jobName} must pin npm before publication`,
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
        const versionStep = namedStep(job, "Compute RC version");
        assertEquals(
          asRecord(versionStep.env, "prerelease version environment"),
          {
            BASE_VERSION: "${{ needs.version-check.outputs.version }}",
            RUN_NUMBER: "${{ needs.tested-run.outputs.release_number }}",
          },
        );
        assertStringIncludes(
          String(versionStep.run),
          'RC_VERSION="${BASE_VERSION}.${RUN_NUMBER}"',
          "prerelease must compute the version from environment variables",
        );
        assertEquals(
          String(versionStep.run).includes(
            "${{ needs.version-check.outputs.version }}",
          ),
          false,
          "prerelease shell must not interpolate the version-check output directly",
        );
      } else {
        const versionStep = namedStep(job, "Read version");
        assertEquals(
          asRecord(versionStep.env, "stable version environment"),
          { VERSION: "${{ needs.version-check.outputs.version }}" },
        );
        assertEquals(
          String(versionStep.run).includes(
            "${{ needs.version-check.outputs.version }}",
          ),
          false,
          "stable shell must not interpolate the version-check output directly",
        );
      }
      assertEquals(
        tokenRepositories(
          jobName === "prerelease"
            ? asRecord(jobs["github-prerelease"], "GitHub prerelease job")
            : job,
        ),
        ["veryfront"],
        `${jobName} release token must only access the release repository`,
      );
      assert(
        Array.isArray(job.needs) &&
          job.needs.includes("quality-gate-artifact"),
        `${jobName} must require the canonical artifact quality gate`,
      );
      assert(
        job.needs.includes("quality-gate-merge"),
        `${jobName} must require the complete merge correctness gate`,
      );
      for (const dependency of MERGE_CORRECTNESS_DEPENDENCIES) {
        assertEquals(
          job.needs.includes(dependency),
          false,
          `${jobName} must inherit ${dependency} through quality-gate-merge`,
        );
      }
    });
  }

  it("publishes GitHub RC assets in parallel with registry validation without weakening dispatch", async () => {
    const jobs = await readJobs();
    const npm = asRecord(jobs.prerelease, "npm prerelease job");
    const npmSteps = steps(npm, "npm prerelease job");
    assertEquals(npmSteps.at(-1)?.name, "Publish tested RC npm artifact");
    assertEquals(npmSteps.some((step) => step.id === "release-app-token"), false);

    const github = asRecord(jobs["github-prerelease"], "GitHub prerelease job");
    assertEquals(github.needs, ["prerelease"]);
    assertEquals(
      github.if,
      "${{ !cancelled() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.prerelease.result == 'success' }}",
    );
    assertEquals(github.environment, npm.environment);
    assertEquals(github["runs-on"], npm["runs-on"]);
    assertEquals(github.permissions, { actions: "read", contents: "read" });
    assertEquals(npm.permissions, { actions: "read", contents: "read", "id-token": "write" });
    const githubSteps = steps(github, "GitHub prerelease job");
    const checkout = githubSteps.find((step) => String(step.uses).startsWith("actions/checkout@"));
    assert(checkout);
    assertEquals(asRecord(checkout.with, "checkout inputs")["persist-credentials"], false);
    const setup = githubSteps.find((step) => step.uses === "./.github/actions/setup-deno");
    assert(setup);
    const download = githubSteps.find((step) =>
      String(step.uses).startsWith("actions/download-artifact@")
    );
    assert(download);
    assertEquals(asRecord(download.with, "binary download inputs"), { path: "binaries" });
    const prepare = namedStep(github, "Prepare RC checkout for SBOM");
    assert(githubSteps.indexOf(checkout) < githubSteps.indexOf(setup));
    assert(githubSteps.indexOf(setup) < githubSteps.indexOf(prepare));
    assert(githubSteps.indexOf(download) < githubSteps.indexOf(prepare));
    for (
      const name of ["Prepare RC checkout for SBOM", "Generate SBOM", "Create GitHub pre-release"]
    ) {
      assertEquals(
        asRecord(namedStep(github, name).env, `${name} environment`).VERSION,
        "${{ needs.prerelease.outputs.version }}",
      );
    }
    const publish = String(namedStep(github, "Create GitHub pre-release").run);
    for (
      const asset of [
        "binaries/veryfront-*/veryfront-*",
        "dist/sbom-${VERSION}/*.json",
        "scripts/install.sh",
        "--prerelease",
      ]
    ) {
      assertStringIncludes(publish, asset);
    }
    const registry = asRecord(jobs["quality-gate-registry"], "registry job");
    assertEquals(registry.needs, ["prerelease", "release", "version-check"]);
  });

  it("prepares the computed RC version before prerelease SBOM generation", async () => {
    const jobs = await readJobs();
    const prerelease = asRecord(jobs["github-prerelease"], "GitHub prerelease job");
    const prereleaseSteps = steps(prerelease, "prerelease job");
    const prepare = namedStep(prerelease, "Prepare RC checkout for SBOM");
    const generate = namedStep(prerelease, "Generate SBOM");

    assertEquals(
      asRecord(prepare.env, "RC SBOM preparation environment"),
      { VERSION: "${{ needs.prerelease.outputs.version }}" },
      "RC SBOM preparation must use the computed numbered version",
    );
    assertEquals(
      prepare.run,
      "deno run -A scripts/ci/prepare-rc-build.ts",
    );
    assert(
      prereleaseSteps.indexOf(prepare) < prereleaseSteps.indexOf(generate),
      "RC checkout preparation must precede SBOM generation",
    );
    assertEquals(
      String(generate.run).includes("prepare-rc-build.ts"),
      false,
      "SBOM generation must not hide version preparation inside the same step",
    );
  });

  it("runs the exact-version registry smoke after the selected release", async () => {
    const jobs = await readJobs();
    const gate = asRecord(
      jobs["quality-gate-registry"],
      "registry quality gate job",
    );
    const gateSteps = steps(gate, "registry quality gate job");
    const buildStep = namedStep(gate, "Build registry validation image");
    const registryStep = namedStep(gate, "Validate exact registry release");

    assertEquals(gate.needs, ["prerelease", "release", "version-check"]);
    assertEquals(
      gateSteps[0]?.name,
      "Report selected release result",
      "selected release result must be reported before checkout",
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
        namedStep(gate, "Report selected release result").env,
        "selected release dependency environment",
      ),
      {
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
        PRERELEASE_RESULT: "${{ needs.prerelease.result }}",
        STABLE_RELEASE_RESULT: "${{ needs.release.result }}",
      },
    );
    assertEquals(buildStep["timeout-minutes"], 5);
    assertStringIncludes(
      String(buildStep.run),
      "FROM node:24-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7",
    );
    assertStringIncludes(
      String(buildStep.run),
      "0cd918870657ccc3d96ac682290e894dda374e2a742424aae9118b258a6cf7a3  /tmp/deno.zip",
    );
    assertStringIncludes(
      String(buildStep.run),
      "https://github.com/denoland/deno/releases/download/v2.7.7/deno-x86_64-unknown-linux-gnu.zip",
    );
    assertStringIncludes(String(buildStep.run), 'build_context="$(mktemp -d)"');
    assertStringIncludes(String(buildStep.run), "RUN mkdir /registry && chown 1000:1000 /registry");
    assertStringIncludes(
      String(buildStep.run),
      'docker build --platform linux/amd64 --tag "$REGISTRY_IMAGE" "$build_context"',
    );
    assertEquals(
      asRecord(buildStep.env, "registry image build environment"),
      {
        REGISTRY_IMAGE:
          "veryfront-registry-validation:${{ github.run_id }}-${{ github.run_attempt }}",
      },
    );
    assertEquals(
      String(buildStep.run).includes("GITHUB_WORKSPACE"),
      false,
      "the image build context must not contain repository content",
    );
    assert(
      gateSteps.indexOf(buildStep) < gateSteps.indexOf(registryStep),
      "registry image must be built before validation",
    );
    assertEquals(
      gateSteps.some((step) => String(step.uses) === "./.github/actions/setup-deno"),
      false,
    );
    assertEquals(
      gateSteps.some((step) => String(step.uses).startsWith("actions/setup-node@")),
      false,
    );
    assertEquals(
      asRecord(registryStep.env, "registry quality gate environment"),
      {
        REGISTRY_IMAGE:
          "veryfront-registry-validation:${{ github.run_id }}-${{ github.run_attempt }}",
        RC_VERSION: "${{ needs.prerelease.outputs.version }}",
        STABLE_VERSION: "${{ needs.release.outputs.version }}",
        GITHUB_SHA: "${{ github.sha }}",
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
      },
    );
    for (
      const required of [
        "docker run --rm --init",
        "--platform linux/amd64",
        "--user 1000:1000",
        "--read-only",
        "--cap-drop ALL",
        "--security-opt no-new-privileges=true",
        "--network=bridge",
        "--volume /registry",
        "--tmpfs /tmp:rw,nosuid,nodev,size=64m",
        "type=bind,source=${GITHUB_WORKSPACE},target=/source,readonly",
        "tar -C /source --exclude=.git --exclude=node_modules --no-same-owner",
        "bash scripts/ci/registry-release-smoke.sh",
      ]
    ) {
      assertStringIncludes(String(registryStep.run), required);
    }
    assertEquals(String(registryStep.run).includes("--pid"), false);
    assertEquals(String(registryStep.run).includes("--network=host"), false);
    assertEquals(String(registryStep.run).includes("--network=container"), false);
  });

  it("gives the registry gate room for the poll and the smoke that follows", async () => {
    // The job runs three things in series, and the poll is only the middle
    // one. Sizing its budget against the whole job left the runner able to be
    // killed while the smoke was still installing -- an unclassified failure
    // in place of the classified one the poll exists to produce.
    const jobs = await readJobs();
    const gate = asRecord(jobs["quality-gate-registry"], "registry quality gate job");
    const setupStep = namedStep(gate, "Build registry validation image");
    const setupMs = Number(setupStep["timeout-minutes"]) * 60_000;
    assert(Number.isFinite(setupMs) && setupMs > 0, "image build must retain the setup budget");

    const { maxAttempts, retryDelayMs } = readPropagationBudget({});
    // The last lookup may begin at the deadline and still spend its request
    // timeout, so the poll ends within budget plus one request.
    const pollMs = (maxAttempts - 1) * retryDelayMs + REQUEST_TIMEOUT_MS;
    const jobMs = Number(gate["timeout-minutes"]) * 60_000;

    assert(
      setupMs + pollMs + SMOKE_ALLOWANCE_MS <= jobMs,
      `setup ${setupMs}ms + poll ${pollMs}ms + smoke ${SMOKE_ALLOWANCE_MS}ms exceeds the ` +
        `${jobMs}ms job`,
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

  it("reports every non-success selected release result without skipping registry validation", async () => {
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
          0,
          `${selectedName}=${selectedResult} must allow registry validation to continue`,
        );
        assert(
          stderr.includes(`${selectedName} finished with ${selectedResult}`),
          stderr,
        );
      }
    }
  });

  it("isolates registry and installed-package code from the credential-bearing host", async () => {
    const jobs = await readJobs();
    const registry = asRecord(jobs["quality-gate-registry"], "registry quality gate job");
    const registrySteps = steps(registry, "registry quality gate job");
    const registryStep = namedStep(registry, "Validate exact registry release");

    // The registry job runs the public package it validates. Only fixed
    // workflow code and pinned third-party actions may run on its host;
    // repository scripts run inside the hardened container command only.
    assertEquals(
      registrySteps.map((step) => String(step.name ?? step.uses).split(" #")[0]),
      [
        "Report selected release result",
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "Build registry validation image",
        "Validate exact registry release",
      ],
      "registry gate must not add host execution around the container",
    );
    for (const step of registrySteps) {
      assertEquals(
        String(step.uses).startsWith("./"),
        false,
        "registry gate must not use local actions",
      );
    }
    assertEquals(
      registrySteps.filter((step) => String(step.run).includes("scripts/")),
      [registryStep],
      "repository scripts may appear only inside the fixed container command",
    );
    assertEquals(
      registrySteps.some((step) =>
        String(step.uses).startsWith("actions/create-github-app-token@")
      ),
      false,
      "registry gate must not hold the downstream release token",
    );
    assertEquals(registry.environment, undefined);

    // The downstream App token exists only in jobs that start after the
    // registry container has terminated, and those jobs run no repository code.
    for (const [name, value] of Object.entries(jobs)) {
      const job = asRecord(value, name);
      const jobSteps = steps(job, name);
      if (
        !jobSteps.some((step) => String(step.uses).startsWith("peter-evans/repository-dispatch@"))
      ) {
        continue;
      }
      assertEquals(name, "dispatch-release");
      assert(
        (job.needs as string[]).includes("quality-gate-registry"),
        `${name} must start only after the registry container job has finished`,
      );
      const tokenIndex = jobSteps.findIndex((step) =>
        step.name === "Create release GitHub App token"
      );
      assert(tokenIndex >= 0, `${name} must create its release token after validation`);
      assertEquals(
        jobSteps.slice(0, tokenIndex + 1).map((step) =>
          String(step.name ?? step.uses).split(" #")[0]
        ),
        ["Resolve published version", "Build dispatch payload", "Create release GitHub App token"],
        `${name} must not add arbitrary host execution before token creation`,
      );
      for (const step of jobSteps) {
        assertEquals(
          String(step.uses).startsWith("./"),
          false,
          `${name} must not use local actions`,
        );
        assertEquals(
          String(step.uses).startsWith("actions/checkout@"),
          false,
          `${name} must not check out repository code`,
        );
        assertEquals(
          String(step.run).includes("scripts/"),
          false,
          `${name} must not execute repository scripts`,
        );
      }
    }
  });

  it("runs registry validation through the hardened container and always cleans it up", async () => {
    const jobs = await readJobs();
    const gate = asRecord(jobs["quality-gate-registry"], "registry quality gate job");
    const registryStep = namedStep(gate, "Validate exact registry release");

    await withTempDir(async (tempDir) => {
      const binDir = `${tempDir}/bin`;
      const dockerLog = `${tempDir}/docker.log`;
      await Deno.mkdir(binDir);
      await Deno.writeTextFile(
        `${binDir}/docker`,
        `#!/usr/bin/env bash
set -euo pipefail
printf 'CALL' >> "$DOCKER_LOG"
for arg in "$@"; do
  encoded="$(printf '%s' "$arg" | base64 | tr -d '\n')"
  printf '\t%s' "$encoded" >> "$DOCKER_LOG"
done
printf '\n' >> "$DOCKER_LOG"
if [ "\${1:-}" = run ]; then
  exit "$DOCKER_RUN_STATUS"
fi
`,
      );
      await Deno.chmod(`${binDir}/docker`, 0o755);

      for (const runStatus of [0, 23]) {
        await Deno.writeTextFile(dockerLog, "");
        const output = await new Deno.Command("bash", {
          args: ["-c", String(registryStep.run)],
          env: {
            PATH: `${binDir}:${Deno.env.get("PATH")}`,
            DOCKER_LOG: dockerLog,
            DOCKER_RUN_STATUS: String(runStatus),
            REGISTRY_IMAGE: "veryfront-registry-validation:123-4",
            RC_VERSION: "1.2.3-rc.4",
            STABLE_VERSION: "",
            GITHUB_SHA: "0123456789abcdef",
            IS_STABLE: "false",
            GITHUB_WORKSPACE: "/synthetic/workspace",
            GITHUB_RUN_ID: "123",
            GITHUB_RUN_ATTEMPT: "4",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(output.code, runStatus);

        const calls = (await Deno.readTextFile(dockerLog)).trim().split("\n").map((record) =>
          record.split("\t").slice(1).map((arg) => atob(arg))
        );
        assertEquals(calls.length, 2);
        assertEquals(calls[0], [
          "run",
          "--rm",
          "--init",
          "--platform",
          "linux/amd64",
          "--name",
          "veryfront-registry-validation-123-4",
          "--user",
          "1000:1000",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges=true",
          "--network=bridge",
          "--volume",
          "/registry",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=64m",
          "--mount",
          "type=bind,source=/synthetic/workspace,target=/source,readonly",
          "--env",
          "RC_VERSION",
          "--env",
          "STABLE_VERSION",
          "--env",
          "GITHUB_SHA",
          "--env",
          "IS_STABLE",
          "--env",
          "HOME=/registry/home",
          "--env",
          "DENO_DIR=/registry/deno-cache",
          "--env",
          "TMPDIR=/registry/tmp",
          "--env",
          "npm_config_cache=/registry/npm-cache",
          "--env",
          "CI=true",
          "veryfront-registry-validation:123-4",
          "bash",
          "-euo",
          "pipefail",
          "-c",
          "mkdir -p /registry/home /registry/deno-cache /registry/tmp /registry/npm-cache /registry/workspace\ntar -C /source --exclude=.git --exclude=node_modules --no-same-owner -cf - . | tar -C /registry/workspace --no-same-owner -xf -\ncd /registry/workspace\nbash scripts/ci/registry-release-smoke.sh",
        ]);
        assertEquals(calls[1], ["rm", "-f", "veryfront-registry-validation-123-4"]);
      }
    });
  });

  it("dispatches exactly three downstream releases only after the registry gate", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["dispatch-release"], "dispatch release job");
    const dispatchSteps = steps(dispatch, "dispatch release job");
    const dispatchActions = dispatchSteps.filter((step) =>
      String(step.uses).startsWith("peter-evans/repository-dispatch@")
    );
    const versionStep = namedStep(dispatch, "Resolve published version");
    const payloadStep = namedStep(dispatch, "Build dispatch payload");
    const tokenStep = namedStep(dispatch, "Create release GitHub App token");

    assertEquals(dispatch.needs, [
      "quality-gate-registry",
      "prerelease",
      "github-prerelease",
      "release",
      "version-check",
    ]);
    assertEquals(
      dispatch.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.quality-gate-registry.result == 'success' && ((needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success') || (needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success' && needs.github-prerelease.result == 'success')) }}",
      "release dispatch must require both registry validation and the selected release job to succeed",
    );
    assertEquals(
      dispatch["timeout-minutes"],
      5,
      "release dispatch must time out if token creation or dispatch hangs",
    );
    assertEquals(
      dispatch.environment,
      "production",
      "release dispatch must remain inside the production approval boundary",
    );
    assertEquals(versionStep.id, "version");
    assertEquals(payloadStep.id, "payload");
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
    assertEquals(
      asRecord(payloadStep.env, "dispatch payload environment"),
      { VERSION: "${{ steps.version.outputs.version }}" },
    );
    assertStringIncludes(
      String(payloadStep.run),
      'jq -cn --arg version "$VERSION"',
      "dispatch payload must pass the version to jq as an argument",
    );
    assertStringIncludes(
      String(payloadStep.run),
      "'{version: $version}'",
      "dispatch payload must be constructed as JSON by jq",
    );
    assert(
      dispatchSteps.indexOf(versionStep) < dispatchSteps.indexOf(payloadStep) &&
        dispatchSteps.indexOf(payloadStep) < dispatchSteps.indexOf(tokenStep),
      "dispatch payload must be built after version resolution and before token creation",
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
        "${{ steps.payload.outputs.payload }}",
      );
    }

    for (
      const [isStable, expected] of [
        ["false", "version=0.1.2-rc.3"],
        ["true", "version=0.1.2"],
      ] as const
    ) {
      const outputFile = await Deno.makeTempFile({
        prefix: "vf-release-version-",
      });
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
