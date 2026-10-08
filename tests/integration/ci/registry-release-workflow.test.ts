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

async function runCurrentRcGuard(
  guard: YamlRecord,
  prelude: string,
  env: Record<string, string>,
): Promise<{ output: Deno.CommandOutput; githubOutput: string }> {
  return await withTempDir(async (stateDir) => {
    const outputFile = `${stateDir}/github-output`;
    const output = await new Deno.Command("bash", {
      args: ["-c", prelude + String(guard.run)],
      env: { ...env, GITHUB_OUTPUT: outputFile },
      stdout: "piped",
      stderr: "piped",
    }).output();
    let githubOutput = "";
    try {
      githubOutput = await Deno.readTextFile(outputFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return { output, githubOutput };
  });
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
      PUBLIC_RELEASE_RESULT: "success",
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
  const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
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

async function canonicalPublisherBody(): Promise<string> {
  const script = await Deno.readTextFile(RELEASE_SCRIPT_PATH);
  return script.replace(/^#!\/usr\/bin\/env bash\n\n/, "").trimEnd();
}

function splitEmbeddedPublisher(run: string): {
  body: string;
  suffix: string;
} {
  const embedded = run.match(
    /publish_github_release\(\) \{\n([\s\S]*?)\n\}\n([\s\S]*)$/,
  );
  assert(embedded, "public uploader must embed the canonical publisher");
  return {
    body: embedded[1].replace(/^ {2}/gm, "").trimEnd(),
    suffix: embedded[2],
  };
}

async function runVersionValidation(
  version: string,
): Promise<Deno.CommandOutput> {
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

async function runStablePublicReleasePreflight(
  publicReleaseStatus: string,
): Promise<Deno.CommandOutput> {
  const jobs = await readJobs();
  const release = asRecord(jobs.release, "stable release job");
  const preflight = namedStep(release, "Ensure stable version is unpublished");

  return await withTempDir(async (stateDir) => {
    await Deno.mkdir(`${stateDir}/bin`, { recursive: true });
    await Deno.mkdir(`${stateDir}/scripts/ci`, { recursive: true });
    await Deno.writeTextFile(
      `${stateDir}/scripts/ci/publish-npm-packages.sh`,
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await Deno.writeTextFile(
      `${stateDir}/bin/git`,
      "#!/usr/bin/env bash\nexit 1\n",
    );
    await Deno.writeTextFile(
      `${stateDir}/bin/gh`,
      "#!/usr/bin/env bash\nexit 1\n",
    );
    await Deno.writeTextFile(
      `${stateDir}/bin/curl`,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$PUBLIC_RELEASE_STATUS"
`,
    );
    for (
      const path of [
        `${stateDir}/scripts/ci/publish-npm-packages.sh`,
        `${stateDir}/bin/git`,
        `${stateDir}/bin/gh`,
        `${stateDir}/bin/curl`,
      ]
    ) {
      await Deno.chmod(path, 0o755);
    }

    return await new Deno.Command("bash", {
      args: ["-c", String(preflight.run)],
      cwd: stateDir,
      env: {
        PATH: `${stateDir}/bin:${Deno.env.get("PATH")}`,
        GH_TOKEN: "synthetic-job-token",
        SOURCE_REPO_TOKEN: "synthetic-source-token",
        VERSION: "1.2.3",
        PUBLIC_RELEASE_STATUS: publicReleaseStatus,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
  });
}

type ReleaseState = "missing" | "draft" | "published";
type CreateFailure = "none" | "after-creation";
type UploadFailureStatus = 1 | 64;

async function runReleaseScript({
  stateDir,
  asset,
  extraAssets = [],
  initialReleaseState = "missing",
  createFailure = "none",
  failedUploadAttempts = 0,
  uploadFailureStatus = 1,
  failedPublishAttempts = 0,
}: {
  stateDir: string;
  asset: string;
  extraAssets?: string[];
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
        "shift",
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
        "    shift 3",
        '    while [ "$1" != "--repo" ]; do',
        '      [ -f "$1" ] || return 1',
        "      shift",
        "    done",
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
        '  "$@"',
      ].join("\n"),
      "release-script-test",
      RELEASE_SCRIPT_PATH,
      asset,
      ...extraAssets,
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

it("starts the largest assets first in the concurrent upload batch", async () => {
  await withTempDir(async (stateDir) => {
    const small = `${stateDir}/metadata.json`;
    const large = `${stateDir}/veryfront large binary`;
    const medium = `${stateDir}/veryfront-proxy`;
    await Deno.writeTextFile(small, "x");
    await Deno.writeTextFile(large, "x".repeat(1024));
    await Deno.writeTextFile(medium, "x".repeat(64));
    const output = await runReleaseScript({
      stateDir,
      asset: small,
      extraAssets: [large, medium],
    });
    assertEquals(output.code, 0, decoder.decode(output.stderr));
    const ghLog = await Deno.readTextFile(`${stateDir}/gh.log`);
    const uploads = ghLog.trim().split("\n").filter((call) => call.startsWith("release upload "));
    assertEquals(uploads, [
      `release upload v1.2.3-rc.4 ${large} ${medium} ${small} --repo veryfront/veryfront --clobber`,
    ], ghLog);
  });
});

describe("registry release workflow", () => {
  it("publishes stable assets while preserving a previously published RC and its tag", async () => {
    const jobs = await readJobs();
    const step = namedStep(
      asRecord(jobs["publish-public-release"], "public release job"),
      "Create GitHub releases",
    );
    await withTempDir(async (stateDir) => {
      for (const path of ["bin", "releases", "public-release-assets"]) {
        await Deno.mkdir(`${stateDir}/${path}`, { recursive: true });
      }
      for (
        const asset of [
          "install.sh",
          "install.ps1",
          "veryfront-linux-x64",
          "sbom.json",
          "SHA256SUMS",
        ]
      ) {
        await Deno.writeTextFile(
          `${stateDir}/public-release-assets/${asset}`,
          "synthetic release asset",
        );
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
  release:upload)
    shift 3
    while [ "$1" != --repo ]; do
      [ -f "$1" ] || exit 1
      shift
    done ;;
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
          IS_STABLE: "true",
          GH_TOKEN: "synthetic",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        await Deno.readTextFile(`${stateDir}/releases/v1.2.3`),
        "published",
      );
      assertEquals(
        await Deno.readTextFile(retainedRelease),
        "published RC assets and tag",
      );
      const calls = (await Deno.readTextFile(`${stateDir}/gh.log`)).trim()
        .split("\n");
      const uploads = calls.filter((call) => call.startsWith("release upload "));
      assertEquals(uploads.length, 1);
      for (
        const asset of [
          "install.sh",
          "install.ps1",
          "veryfront-linux-x64",
          "sbom.json",
          "SHA256SUMS",
        ]
      ) {
        assertStringIncludes(uploads[0], `public-release-assets/${asset}`);
      }
      assertStringIncludes(calls.join("\n"), "--prerelease=false --latest");
    });
  });

  for (const failedUploadAttempts of [0, 1, 3]) {
    it(`uploads every asset in one batch with ${failedUploadAttempts} failed attempts`, async () => {
      await withTempDir(async (stateDir) => {
        const assets = [
          `${stateDir}/veryfront-linux-x64`,
          `${stateDir}/veryfront macos arm64`,
          `${stateDir}/SHA256SUMS`,
        ];
        for (const asset of assets) await Deno.writeTextFile(asset, "binary");
        const output = await runReleaseScript({
          stateDir,
          asset: assets[0],
          extraAssets: assets.slice(1),
          failedUploadAttempts,
        });
        const calls = (await Deno.readTextFile(`${stateDir}/gh.log`)).trim()
          .split("\n");
        const uploads = calls.filter((call) => call.startsWith("release upload "));
        assertEquals(uploads.length, Math.min(failedUploadAttempts + 1, 3));
        for (const upload of uploads) {
          assertEquals(
            upload,
            `release upload v1.2.3-rc.4 ${assets.join(" ")} --repo veryfront/veryfront --clobber`,
          );
        }
        assertEquals(output.code, failedUploadAttempts === 3 ? 1 : 0);
        const publications = calls.filter((call) => call.startsWith("release edit "));
        assertEquals(publications.length, failedUploadAttempts === 3 ? 0 : 1);
        const deletions = calls.filter((call) => call.startsWith("release delete "));
        assertEquals(deletions.length, failedUploadAttempts === 3 ? 1 : 0);
        if (publications.length) {
          assert(
            calls.indexOf(publications[0]) > calls.lastIndexOf(uploads.at(-1)!),
          );
        }
      });
    });
  }

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

  it("embeds the canonical retrying publisher in the isolated public release job", async () => {
    const jobs = await readJobs();
    const uploader = asRecord(
      jobs["publish-public-release"],
      "public release job",
    );
    const run = String(namedStep(uploader, "Create GitHub releases").run);
    const embedded = splitEmbeddedPublisher(run);
    assertEquals(
      embedded.body,
      await canonicalPublisherBody(),
      "the checkout-free publisher must retain the complete tested helper",
    );
    assertStringIncludes(embedded.suffix, "assets=(public-release-assets/*)");
    assertStringIncludes(embedded.suffix, "mode=--latest");
    assertStringIncludes(embedded.suffix, "mode=--prerelease");
    assert(
      /publish_github_release --repo veryfront\/veryfront \\\n[ ]{2}--tag "v\$\{VERSION\}" --title "v\$\{VERSION\}" --notes "\$notes" \\\n[ ]{2}"\$mode" -- "\$\{assets\[@\]\}"\s*$/
        .test(
          embedded.suffix,
        ),
      "the fixed uploader must pass only the selected mode and inert artifact files",
    );
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
        jobSteps.filter((step) => String(step.uses).startsWith("actions/create-github-app-token@"))
          .length,
        0,
        `${jobName} must not receive a release App token`,
      );
      const assetJob = jobName === "prerelease"
        ? asRecord(jobs["github-prerelease"], "GitHub prerelease job")
        : job;
      const assetSteps = steps(assetJob, `${jobName} asset job`);
      assertEquals(
        assetSteps.filter((step) =>
          String(step.uses).startsWith("actions/create-github-app-token@")
        )
          .length,
        0,
        `${jobName} asset preparation must not receive a release App token`,
      );
      const artifact = assetSteps.find((step) =>
        String(step.uses).startsWith("actions/upload-artifact@") &&
        asRecord(step.with, `${jobName} artifact inputs`).name ===
          "public-release-${{ github.sha }}"
      );
      assert(artifact, `${jobName} must prepare the public release artifact`);
      assertEquals(
        asRecord(artifact.with, `${jobName} artifact inputs`).path,
        "dist/public-release/",
      );
      assert(
        Array.isArray(job.needs) &&
          job.needs.includes("quality-gate-artifact"),
        `${jobName} must require the canonical artifact quality gate`,
      );
      assert(
        job.needs.includes("sonar") &&
          namedStep(job, "Require merge correctness dependencies") !== undefined,
        `${jobName} must evaluate the complete merge correctness gate after Sonar`,
      );
      for (const dependency of MERGE_CORRECTNESS_DEPENDENCIES) {
        assertEquals(
          job.needs.includes(dependency),
          true,
          `${jobName} must read ${dependency} in its folded correctness gate`,
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
    assertEquals(github.needs, ["prerelease", "build-binaries"]);
    assertEquals(
      github.if,
      "${{ !cancelled() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.prerelease.result == 'success' && needs.build-binaries.result == 'success' }}",
    );
    assertEquals(github.environment, npm.environment);
    assertEquals(github["runs-on"], npm["runs-on"]);
    assertEquals(github.permissions, { actions: "read", contents: "read" });
    assertEquals(npm.permissions, { actions: "read", contents: "read", "id-token": "write" });
    assertEquals(
      JSON.stringify(github).includes("VERYFRONT_RELEASE_APP_"),
      false,
      "GitHub prerelease asset preparation must never receive the release App identity",
    );
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
      const name of [
        "Prepare RC checkout for SBOM",
        "Generate SBOM",
        "Prepare public release assets",
      ]
    ) {
      assertEquals(
        asRecord(namedStep(github, name).env, `${name} environment`).VERSION,
        "${{ needs.prerelease.outputs.version }}",
      );
    }
    const prepareAssets = String(namedStep(github, "Prepare public release assets").run);
    for (
      const asset of [
        "binaries/veryfront-*/veryfront-*",
        "dist/sbom-${VERSION}/*.json",
        "scripts/install.sh",
      ]
    ) {
      assertStringIncludes(prepareAssets, asset);
    }
    const registry = asRecord(jobs["registry-validation-rc"], "registry job");
    assertEquals(registry.needs, ["prerelease", "version-check"]);
  });

  it("keeps publisher repository execution off release-App runners", async () => {
    const jobs = await readJobs();
    for (const jobName of ["prerelease", "github-prerelease", "release"]) {
      const job = asRecord(jobs[jobName], `${jobName} job`);
      assertEquals(
        JSON.stringify(job).includes("VERYFRONT_RELEASE_APP_"),
        false,
        `${jobName} must never receive the downstream-capable App identity or key`,
      );
      assertEquals(
        steps(job, jobName).filter((step) =>
          String(step.uses).startsWith("actions/create-github-app-token@")
        ).length,
        0,
      );
    }
    const allowedActions = {
      "publish-public-release": [
        "actions/download-artifact@",
        "actions/create-github-app-token@",
      ],
      "quality-gate-registry": [
        "actions/create-github-app-token@",
        "peter-evans/repository-dispatch@",
      ],
    } as const;
    for (
      const jobName of ["publish-public-release", "quality-gate-registry"] as const
    ) {
      const job = asRecord(jobs[jobName], jobName);
      const allSteps = steps(job, jobName);
      const validationIndex = allSteps.findIndex((step) =>
        step.name === "Validate exact registry release"
      );
      if (jobName === "quality-gate-registry") {
        assert(validationIndex >= 0);
        const workflow = asRecord(parse(await Deno.readTextFile(WORKFLOW_PATH)), "workflow");
        assertEquals(
          asRecord(job.permissions ?? workflow.permissions, "registry permissions").contents,
          "read",
          "registry code must run with a read-only default repository token",
        );
        for (const step of allSteps.slice(0, validationIndex + 1)) {
          assertEquals(
            String(step.uses ?? "").startsWith("actions/create-github-app-token@"),
            false,
            "registry validation must finish before any release App token is created",
          );
        }
        assertEquals(
          JSON.stringify(allSteps.slice(0, validationIndex + 1)).includes("VERYFRONT_RELEASE_APP_"),
          false,
          "registry code must not receive the downstream identity before container termination",
        );
      }
      const privilegedSteps = jobName === "quality-gate-registry"
        ? allSteps.slice(validationIndex + 1)
        : allSteps;
      for (const step of privilegedSteps) {
        const action = String(step.uses ?? "");
        assert(
          action === "" ||
            allowedActions[jobName].some((prefix) => action.startsWith(prefix)),
          `${jobName} must not run unapproved action ${action}`,
        );
        let executableRun = String(step.run ?? "").replace(
          /notes='[\s\S]*?'\n/g,
          "",
        );
        if (
          jobName === "publish-public-release" &&
          step.name === "Create GitHub releases"
        ) {
          executableRun = splitEmbeddedPublisher(executableRun).suffix;
        }
        assertEquals(
          /^(?:\s*)(?:bash|sh|source|eval|exec|python3?|deno|node|npm|npx|bun)(?:\s|$)/m
            .test(
              executableRun,
            ),
          false,
          `${jobName} must never invoke a general interpreter or package command`,
        );
        assertEquals(
          /(?:^|\s)(?:\.\/public-release-assets\/|(?:bash|sh|source|eval|exec|python3?)\s+[^\n]*public-release-assets)/m
            .test(
              executableRun,
            ),
          false,
          `${jobName} must never execute a downloaded release artifact`,
        );
      }
    }
    assertEquals(
      tokenRepositories(
        asRecord(jobs["publish-public-release"], "public uploader"),
      ),
      [
        "veryfront",
      ],
    );
    assertEquals(
      tokenRepositories(asRecord(jobs["quality-gate-registry"], "dispatch")),
      [
        "veryfront-server",
        "veryfront-job-runner",
        "veryfront-sandbox",
      ],
    );
  });

  it("replaces the inert release artifact when the same workflow run is rerun", async () => {
    const jobs = await readJobs();
    for (const jobName of ["github-prerelease", "release"]) {
      const upload = namedStep(
        asRecord(jobs[jobName], jobName),
        "Upload public release assets",
      );
      assertEquals(asRecord(upload.with, `${jobName} artifact inputs`), {
        name: "public-release-${{ github.sha }}",
        path: "dist/public-release/",
        "if-no-files-found": "error",
        overwrite: true,
      });
    }
  });

  it("publishes the selected release from an inert artifact in one isolated job", async () => {
    const jobs = await readJobs();
    const uploader = asRecord(
      jobs["publish-public-release"],
      "public release job",
    );
    const uploaderSteps = steps(uploader, "public release job");
    const download = uploaderSteps.find((step) =>
      String(step.uses).startsWith("actions/download-artifact@")
    );
    const token = namedStep(uploader, "Create release GitHub App token");
    const publish = namedStep(uploader, "Create GitHub releases");

    assertEquals(uploader.needs, [
      "prerelease",
      "github-prerelease",
      "release",
      "version-check",
    ]);
    assertEquals(
      uploader.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && ((needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success' && needs.github-prerelease.result == 'success') || (needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success')) }}",
    );
    assert(download, "public release job must download the inert artifact");
    assertEquals(
      asRecord(download.with, "public release artifact inputs"),
      {
        name: "public-release-${{ github.sha }}",
        path: "public-release-assets",
      },
    );
    assertEquals(token.id, "release-app-token");
    assertEquals(tokenRepositories(uploader), ["veryfront"]);
    assertEquals(
      asRecord(publish.env, "public release environment"),
      {
        GH_TOKEN: "${{ steps.release-app-token.outputs.token }}",
        VERSION: "${{ steps.version.outputs.version }}",
        IS_STABLE: "${{ needs.version-check.outputs.is_stable }}",
        MAINTENANCE_RELEASE:
          "${{ github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '' }}",
      },
    );
    assert(
      uploaderSteps.indexOf(download) < uploaderSteps.indexOf(token) &&
        uploaderSteps.indexOf(token) < uploaderSteps.indexOf(publish),
      "the inert artifact must be downloaded before the scoped token is minted",
    );
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

  it("fails closed when checking whether a stable public release already exists", async () => {
    for (
      const [status, expectedCode] of [
        ["200", 1],
        ["404", 0],
        ["403", 1],
        ["500", 1],
      ] as const
    ) {
      const output = await runStablePublicReleasePreflight(status);
      assertEquals(
        output.code,
        expectedCode,
        `public release lookup status ${status} must produce exit ${expectedCode}: ${
          decoder.decode(output.stderr)
        }`,
      );
    }

    const jobs = await readJobs();
    const release = asRecord(jobs.release, "stable release job");
    const run = String(
      namedStep(release, "Ensure stable version is unpublished").run,
    );
    assertStringIncludes(
      run,
      "https://api.github.com/repos/veryfront/veryfront/releases/tags/${TAG}",
    );
    assertStringIncludes(run, "--output /dev/null");
    assertStringIncludes(run, "--write-out '%{http_code}'");
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

    assertEquals(
      gate.needs,
      [
        "sonar-quality-gate",
        "prerelease",
        "github-prerelease",
        "registry-validation-rc",
        "release",
        "publish-public-release",
        "version-check",
      ],
      "final dispatch must join RC validation and public release publication",
    );
    assertEquals(
      gateSteps[0]?.name,
      "Require fresh Sonar quality gate",
      "Sonar must pass before registry or dispatch code runs",
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
        PUBLIC_RELEASE_RESULT: "${{ needs.publish-public-release.result }}",
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
        "Require fresh Sonar quality gate",
        "Report selected release result",
        "Require RC release dependencies",
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "Build registry validation image",
        "Validate exact registry release",
        "Resolve published version",
        "Check current RC tag",
        "Build dispatch payload",
        "Create release GitHub App token",
        "Trigger server deploy",
        "Trigger job-runner deploy",
        "Trigger sandbox deploy",
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
      true,
      "registry gate creates the downstream token only after isolated validation",
    );
    assertEquals(registry.environment, "production");

    // The downstream App token is created only after the container terminates.
    // Every subsequent step is fixed workflow code or a pinned remote action.
    for (const [name, value] of Object.entries(jobs)) {
      const job = asRecord(value, name);
      if (job.uses !== undefined) {
        assert(
          /^veryfront\/veryfront-code\/\.github\/workflows\/cancel-failed-merge-group\.yml@[0-9a-f]{40}$/
            .test(String(job.uses)),
          `${name} must run the cancellation workflow pinned to a trusted commit`,
        );
        assertEquals(job.if, "${{ failure() && github.event_name == 'merge_group' }}");
        assertEquals(job.permissions, { actions: "write" });
        assertEquals(job.steps, undefined);
        continue;
      }
      const jobSteps = steps(job, name);
      if (
        !jobSteps.some((step) => String(step.uses).startsWith("peter-evans/repository-dispatch@"))
      ) {
        continue;
      }
      assertEquals(name, "quality-gate-registry");
      assert(
        jobSteps.indexOf(registryStep) <
          jobSteps.findIndex((step) => step.name === "Create release GitHub App token"),
        `${name} must create credentials only after the registry container has finished`,
      );
      const tokenIndex = jobSteps.findIndex((step) =>
        step.name === "Create release GitHub App token"
      );
      assert(tokenIndex >= 0, `${name} must create its release token after validation`);
      assertEquals(
        jobSteps.slice(jobSteps.indexOf(registryStep) + 1, tokenIndex + 1).map((step) =>
          String(step.name ?? step.uses).split(" #")[0]
        ),
        [
          "Resolve published version",
          "Check current RC tag",
          "Build dispatch payload",
          "Create release GitHub App token",
        ],
        `${name} must not add arbitrary host execution before token creation`,
      );
      for (const step of jobSteps.slice(jobSteps.indexOf(registryStep) + 1)) {
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
  it("executes only fixed workflow logic on the downstream App-key runner", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
    const allowedActions = [
      "actions/create-github-app-token@",
      "peter-evans/repository-dispatch@",
    ];
    const jobSteps = steps(dispatch, "dispatch release job");
    const validation = namedStep(dispatch, "Validate exact registry release");
    for (const step of jobSteps.slice(jobSteps.indexOf(validation) + 1)) {
      const action = String(step.uses ?? "");
      assert(
        action === "" || allowedActions.some((prefix) => action.startsWith(prefix)),
        `dispatch must not run unapproved action ${action}`,
      );
      const run = String(step.run ?? "");
      assertEquals(
        /^(?:\s*)(?:bash|sh|source|eval|exec|python3?|deno|node|npm|npx|bun)(?:\s|$)/m.test(run),
        false,
        "dispatch must not invoke repository code or a package command",
      );
      assertEquals(/(?:scripts\/|\.\/|GITHUB_WORKSPACE)/.test(run), false);
    }
  });

  it("serializes RC tag writes and dispatch independently without replacing pending jobs", async () => {
    const jobs = await readJobs();
    for (
      const [name, group] of [
        ["prerelease", "veryfront-rc-publication"],
        ["quality-gate-registry", "veryfront-rc-dispatch"],
      ] as const
    ) {
      const job = asRecord(jobs[name], name);
      assertEquals(job.concurrency, { group, queue: "max" });
    }
    const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
    const guard = namedStep(dispatch, "Check current RC tag");
    assertStringIncludes(
      String(guard.run),
      "https://registry.npmjs.org/-/package/veryfront/dist-tags",
    );
    const dispatchSteps = steps(dispatch, "dispatch release job");
    const token = namedStep(dispatch, "Create release GitHub App token");
    assertEquals(
      token.if,
      "${{ success() && needs.publish-public-release.result == 'success' && ((needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success') || (needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success' && needs.github-prerelease.result == 'success' && needs.registry-validation-rc.result == 'success')) && steps.current.outputs.dispatch == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '') }}",
    );
    assert(dispatchSteps.indexOf(guard) < dispatchSteps.indexOf(token));
    for (
      const step of dispatchSteps.filter((step) =>
        String(step.uses).startsWith("peter-evans/repository-dispatch@")
      )
    ) {
      assertEquals(
        step.if,
        "${{ success() && needs.publish-public-release.result == 'success' && ((needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success') || (needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success' && needs.github-prerelease.result == 'success' && needs.registry-validation-rc.result == 'success')) && steps.current.outputs.dispatch == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '') }}",
      );
      assert(dispatchSteps.indexOf(guard) < dispatchSteps.indexOf(step));
    }
  });

  for (
    const [current, candidate, stable, expectedCode, expectedOutput] of [
      ["0.1.2-rc.201", "0.1.2-rc.200", "false", 0, "dispatch=false"],
      ["0.1.2-rc.201", "0.1.2-rc.201", "false", 0, "dispatch=true"],
      ["0.1.2-rc.200", "0.1.2-rc.201", "false", 5, ""],
      ["", "0.1.2", "true", 0, "dispatch=true"],
    ] as const
  ) {
    it(`guards ${candidate} dispatch against ${current || "no tag"}`, async () => {
      const jobs = await readJobs();
      const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
      const guard = namedStep(dispatch, "Check current RC tag");
      const { output, githubOutput } = await runCurrentRcGuard(
        guard,
        'curl() { printf "%s\\n" "$CURRENT_TAGS"; }\n',
        {
          IS_STABLE: stable,
          VERSION: candidate,
          CURRENT_TAGS: JSON.stringify(current ? { rc: current } : {}),
        },
      );
      assertEquals(output.code, expectedCode, decoder.decode(output.stderr));
      if (expectedOutput) assertStringIncludes(githubOutput, expectedOutput);
    });
  }

  it("keeps the inline dispatch comparator identical to the publisher", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
    const guard = String(namedStep(dispatch, "Check current RC tag").run);
    const publisher = await Deno.readTextFile(
      new URL("../../../scripts/ci/publish-npm-packages.sh", import.meta.url),
    );
    const expression = /jq -ner --arg candidate[^\n]*'\n([\s\S]*?)\n\s*'/;
    const normalize = (value: string | undefined) =>
      value?.split("\n").map((line) => line.trim()).join("\n");
    const inline = guard.match(expression)?.[1];
    const shared = publisher.match(expression)?.[1];
    assert(inline && shared, "both guards must include the reviewed jq comparator");
    assertEquals(normalize(inline), normalize(shared));
    assertStringIncludes(guard, "--arg mode dispatch");
  });

  for (
    const [current, candidate, expectedCode, expectedOutput] of [
      ["0.1.2-beta.201", "0.1.2-beta.200", 0, "dispatch=false"],
      ["0.1.2-rc.preview.201", "0.1.2-rc.preview.200", 0, "dispatch=false"],
      ["0.1.2-alpha.10.200", "0.1.2-alpha.9.999", 0, "dispatch=false"],
      ["0.1.2-rc.1", "0.1.2-beta.200", 0, "dispatch=false"],
      ["0.1.2-rc.preview.200", "0.1.2-rc.999", 0, "dispatch=false"],
      ["0.1.2-rc.1.preview.1", "0.1.2-rc.1.200", 0, "dispatch=false"],
      ["0.1.10-rc.1", "0.1.9-rc.999", 0, "dispatch=false"],
      ["0.1.2-rc.9007199254740993", "0.1.2-rc.9007199254740992", 0, "dispatch=false"],
      ["0.1.2-rc.1.preview.1", "0.1.2-rc.1.preview.1", 0, "dispatch=true"],
      ["0.1.2", "0.1.2-rc.200", 4, ""],
      ["0.1.2-rc..200", "0.1.2-rc.200", 4, ""],
      ["0.1.2-rc.0201", "0.1.2-rc.200", 5, ""],
      ["0.1.2-rc.200", "0.1.2-rc.0200", 5, ""],
    ] as const
  ) {
    it(`preserves dispatch precedence for ${candidate} against ${current}`, async () => {
      const jobs = await readJobs();
      const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
      const guard = namedStep(dispatch, "Check current RC tag");
      const { output, githubOutput } = await runCurrentRcGuard(
        guard,
        'curl() { printf "%s\\n" "$CURRENT_TAGS"; }\n',
        {
          IS_STABLE: "false",
          VERSION: candidate,
          CURRENT_TAGS: JSON.stringify({ rc: current }),
        },
      );
      assertEquals(output.code, expectedCode, decoder.decode(output.stderr));
      if (expectedOutput) assertStringIncludes(githubOutput, expectedOutput);
      else assertEquals(githubOutput, "");
    });
  }

  for (const tags of ["{}", "not-json", '{"rc":123}', '{"rc":null}', '{"rc":""}']) {
    it(`fails closed on invalid registry dist-tags ${tags}`, async () => {
      const jobs = await readJobs();
      const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
      const guard = namedStep(dispatch, "Check current RC tag");
      const { output, githubOutput } = await runCurrentRcGuard(
        guard,
        'curl() { printf "%s\\n" "$CURRENT_TAGS"; }\n',
        {
          IS_STABLE: "false",
          VERSION: "0.1.2-rc.200",
          CURRENT_TAGS: tags,
        },
      );
      assert(output.code !== 0);
      assertEquals(githubOutput, "");
    });
  }

  it("fails closed on registry transport errors and skips lookup for stable dispatch", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
    const guard = namedStep(dispatch, "Check current RC tag");
    for (const stable of ["false", "true"]) {
      const { output, githubOutput } = await runCurrentRcGuard(
        guard,
        "curl() { echo lookup >&2; return 22; }\n",
        {
          IS_STABLE: stable,
          VERSION: stable === "true" ? "0.1.2" : "0.1.2-rc.200",
        },
      );
      assertEquals(output.code, stable === "true" ? 0 : 22);
      assertEquals(githubOutput, stable === "true" ? "dispatch=true\n" : "");
      assertEquals(decoder.decode(output.stderr), stable === "true" ? "" : "lookup\n");
    }
  });

  it("dispatches exactly three downstream releases only after the registry gate", async () => {
    const jobs = await readJobs();
    const dispatch = asRecord(jobs["quality-gate-registry"], "dispatch release job");
    const dispatchSteps = steps(dispatch, "dispatch release job");
    const dispatchActions = dispatchSteps.filter((step) =>
      String(step.uses).startsWith("peter-evans/repository-dispatch@")
    );
    const versionStep = namedStep(dispatch, "Resolve published version");
    const payloadStep = namedStep(dispatch, "Build dispatch payload");
    const tokenStep = namedStep(dispatch, "Create release GitHub App token");

    assertEquals(dispatch.needs, [
      "sonar-quality-gate",
      "prerelease",
      "github-prerelease",
      "registry-validation-rc",
      "release",
      "publish-public-release",
      "version-check",
    ]);
    assertEquals(
      dispatch.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.version-check.result == 'success' && (needs.version-check.outputs.is_stable == 'false' || needs.version-check.outputs.stable_release_requested == 'true') }}",
      "registry diagnostics must retain admission after selected publication failure",
    );
    assertEquals(
      tokenStep["timeout-minutes"],
      5,
      "release token creation must time out if it hangs",
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

  it("updates Homebrew only after the stable public release upload succeeds", async () => {
    const jobs = await readJobs();
    const homebrew = asRecord(jobs["update-homebrew"], "Homebrew job");

    assertEquals(homebrew.needs, [
      "release",
      "publish-public-release",
      "version-check",
    ]);
    assertEquals(
      String(homebrew.if).includes("always()"),
      false,
      "Homebrew must retain the default success requirement for every dependency",
    );
  });
});

describe("folded registry dispatch", () => {
  it("dispatches after isolated validation without another runner", async () => {
    const jobs = await readJobs();
    assertEquals(jobs["dispatch-release"], undefined);
    const gate = asRecord(jobs["quality-gate-registry"], "registry");
    const jobSteps = steps(gate, "registry");
    const validate = namedStep(gate, "Validate exact registry release");
    const token = namedStep(gate, "Create release GitHub App token");
    assert(jobSteps.indexOf(validate) < jobSteps.indexOf(token));
    assertEquals(gate.environment, "production");
    const dispatchSteps = jobSteps.slice(jobSteps.indexOf(validate) + 1);
    for (const step of dispatchSteps) {
      assertEquals(
        step.if,
        "${{ success() && needs.publish-public-release.result == 'success' && ((needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success') || (needs.version-check.outputs.is_stable == 'false' && needs.prerelease.result == 'success' && needs.github-prerelease.result == 'success' && needs.registry-validation-rc.result == 'success'))" +
          (step.uses
            ? " && steps.current.outputs.dispatch == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '')"
            : "") +
          " }}",
      );
      assertEquals(step["timeout-minutes"], 5);
      assertEquals(String(step.run).includes("scripts/"), false);
      assertEquals(String(step.uses).startsWith("./"), false);
    }
    assertEquals(dispatchSteps.length, 7);
  });
});

describe("parallel RC registry validation with folded stable dispatch", () => {
  it("validates RCs after npm without public assets or release credentials", async () => {
    const jobs = await readJobs();
    const registry = asRecord(jobs["registry-validation-rc"], "RC registry validator");
    assertEquals(registry.name, "registry validation (RC)");
    assertEquals(registry.needs, ["prerelease", "version-check"]);
    assertEquals(registry.environment, undefined);
    assertEquals(registry.concurrency, undefined);
    assertEquals(registry.permissions, { contents: "read" });
    assertEquals(
      registry.if,
      "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && needs.version-check.result == 'success' && needs.version-check.outputs.is_stable == 'false' }}",
    );
    assertEquals(JSON.stringify(registry).includes("VERYFRONT_RELEASE_APP_"), false);
    const validate = namedStep(registry, "Validate exact registry release");
    assertStringIncludes(String(validate.run), "--read-only");
    assertStringIncludes(String(validate.run), "--cap-drop ALL");
    assertStringIncludes(String(validate.run), "bash scripts/ci/registry-release-smoke.sh");
    assertEquals(
      steps(registry, "RC registry").filter((step) =>
        String(step.uses).startsWith("actions/create-github-app-token@")
      ).length,
      0,
    );
  });

  it("joins registry and public assets before RC dispatch while keeping stable validation inline", async () => {
    const jobs = await readJobs();
    const join = asRecord(jobs["quality-gate-registry"], "registry and publication join");
    assertEquals(join.needs, [
      "sonar-quality-gate",
      "prerelease",
      "github-prerelease",
      "registry-validation-rc",
      "release",
      "publish-public-release",
      "version-check",
    ]);
    assertEquals(join.name, "quality gate (registry)");
    assertEquals(
      namedStep(join, "Validate exact registry release").if,
      "${{ needs.version-check.outputs.is_stable == 'true' }}",
    );
    for (
      const name of [
        "Resolve published version",
        "Check current RC tag",
        "Build dispatch payload",
        "Create release GitHub App token",
        "Trigger server deploy",
        "Trigger job-runner deploy",
        "Trigger sandbox deploy",
      ]
    ) {
      const step = namedStep(join, name);
      assertStringIncludes(String(step.if), "success()");
      assertStringIncludes(String(step.if), "needs.publish-public-release.result == 'success'");
      assertStringIncludes(String(step.if), "needs.registry-validation-rc.result == 'success'");
      assertStringIncludes(String(step.if), "needs.github-prerelease.result == 'success'");
      assertStringIncludes(String(step.if), "needs.prerelease.result == 'success'");
      assertStringIncludes(
        String(step.if),
        "needs.version-check.outputs.is_stable == 'true' && needs.release.result == 'success'",
      );
    }
  });
});

describe("RC dispatch join failure handling", () => {
  it("fails the canonical gate for every unsuccessful RC dependency", async () => {
    const jobs = await readJobs();
    const join = asRecord(jobs["quality-gate-registry"], "join");
    const step = namedStep(join, "Require RC release dependencies");
    assertEquals(step.if, "${{ needs.version-check.outputs.is_stable == 'false' }}");
    const bindings = {
      PRERELEASE_RESULT: "${{ needs.prerelease.result }}",
      ASSETS_RESULT: "${{ needs.github-prerelease.result }}",
      PUBLIC_RELEASE_RESULT: "${{ needs.publish-public-release.result }}",
      REGISTRY_RESULT: "${{ needs.registry-validation-rc.result }}",
    };
    assertEquals(step.env, bindings);
    const success = Object.fromEntries(Object.keys(bindings).map((name) => [name, "success"]));
    for (const name of Object.keys(bindings)) {
      for (const result of ["failure", "cancelled", "skipped", ""]) {
        const output = await new Deno.Command("bash", {
          args: ["-c", String(step.run)],
          env: { ...success, [name]: result },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(output.code, 1, `${name}=${result} must fail the join`);
      }
    }
    const output = await new Deno.Command("bash", {
      args: ["-c", String(step.run)],
      env: success,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    const validator = asRecord(jobs["registry-validation-rc"], "RC validator");
    assertEquals(
      namedStep(validator, "Validate exact registry release").run,
      namedStep(join, "Validate exact registry release").run,
    );
    assertEquals(
      Object.values(jobs).filter((job) => asRecord(job, "job").name === "quality gate (registry)")
        .length,
      1,
    );
  });
});

describe("bounded RC publication and deferred metadata verification", () => {
  it("keeps tag verification after immutable validation in the read-only registry job", async () => {
    const script = await Deno.readTextFile(
      new URL("../../../scripts/ci/registry-release-smoke.sh", import.meta.url),
    );
    assertStringIncludes(script, 'rc_tag_arg="--require-rc-tag"');
    assertStringIncludes(script, "${rc_tag_arg:+$rc_tag_arg}");
    assertStringIncludes(script, 'if [[ "${IS_STABLE:-}" != "true" ]]');
    assert(
      script.indexOf('rc_tag_arg="--require-rc-tag"') <
        script.indexOf('scripts/ci/registry-release-integrity.ts"'),
    );
    const jobs = await readJobs();
    const registry = asRecord(
      jobs["registry-validation-rc"],
      "RC registry validator",
    );
    assertEquals(registry.permissions, { contents: "read" });
    assertEquals(registry.environment, undefined);
    const setupMs = Number(
      namedStep(
        registry,
        "Build registry validation image",
      )["timeout-minutes"],
    ) * 60_000;
    const { maxAttempts, retryDelayMs } = readPropagationBudget({});
    const pollMs = (maxAttempts - 1) * retryDelayMs + REQUEST_TIMEOUT_MS;
    assert(
      setupMs + pollMs + SMOKE_ALLOWANCE_MS <=
        Number(registry["timeout-minutes"]) * 60_000,
    );
    assertEquals(
      asRecord(jobs["quality-gate-registry"], "required registry join").needs,
      [
        "sonar-quality-gate",
        "prerelease",
        "github-prerelease",
        "registry-validation-rc",
        "release",
        "publish-public-release",
        "version-check",
      ],
    );
  });
});

type ParallelJob = { needs: string[]; if: string; steps: Record<string, unknown>[] };
async function parallelJobs(): Promise<Record<string, ParallelJob>> {
  const workflow = parse(
    await Deno.readTextFile(
      new URL("../../../.github/workflows/cicd.yml", import.meta.url),
    ),
  ) as { jobs: Record<string, ParallelJob> };
  return workflow.jobs;
}

describe("RC publication alongside the reused main Sonar scan", () => {
  it("keeps the reused scan out of publication ancestors and retains fallback scanning", async () => {
    const graph = await parallelJobs();
    assert(graph["sonar-main"], "reuse must have its own parallel scan");
    assertEquals(graph["sonar-coverage-main"].needs, ["tested-run", "version-check"]);
    assertStringIncludes(graph["sonar-coverage"].if, "needs.tested-run.outputs.reuse != 'true'");
    assertStringIncludes(graph["sonar-main"].if, "needs.tested-run.outputs.reuse == 'true'");
    const visit = (name: string): string[] => [name, ...(graph[name].needs ?? []).flatMap(visit)];
    for (
      const name of [
        "prerelease",
        "registry-validation-rc",
        "github-prerelease",
        "publish-public-release",
      ]
    ) {
      assertEquals(visit(name).includes("sonar-main"), false);
    }
    assert(graph.prerelease.needs.includes("sonar"));
    assertEquals(graph.prerelease.needs.includes("build-binaries"), false);
    assert(graph["github-prerelease"].needs.includes("build-binaries"));
    assertStringIncludes(graph["github-prerelease"].if, "needs.build-binaries.result == 'success'");
    assert(graph.release.needs.includes("sonar"));
    assertEquals(graph["sonar-main"].steps, graph.sonar.steps);
    assertEquals(graph["sonar-coverage-main"].steps, graph["sonar-coverage"].steps);
  });

  it("selects the parallel scan only for RC reuse and preserves stable reused coverage", async () => {
    const graph = await parallelJobs();
    const parallel =
      "needs.tested-run.outputs.reuse == 'true' && needs.version-check.outputs.is_stable == 'false'";
    const original =
      "(needs.tested-run.outputs.reuse != 'true' || needs.version-check.outputs.is_stable != 'false')";
    for (const name of ["sonar-main", "sonar-coverage-main"]) {
      assertStringIncludes(graph[name].if, parallel);
      assert(graph[name].needs.includes("version-check"));
    }
    for (const name of ["sonar", "sonar-coverage"]) {
      assertStringIncludes(graph[name].if, original);
      assert(graph[name].needs.includes("version-check"));
    }
    assertStringIncludes(graph["sonar-coverage"].if, "needs.tested-run.outputs.reuse == 'true' ||");
    const gate = graph["sonar-quality-gate"].steps[0];
    assertEquals(gate.env, {
      SONAR_RESULT: "${{ " + parallel + " && needs.sonar-main.result || needs.sonar.result }}",
    });
  });

  it("blocks dispatch for every unsuccessful fresh Sonar result", async () => {
    const graph = await parallelJobs();
    const dispatch = graph["quality-gate-registry"];
    assert(dispatch.needs.includes("sonar-quality-gate"));
    const guard = dispatch.steps[0];
    assertEquals(guard.name, "Require fresh Sonar quality gate");
    assertEquals(guard.env, { SONAR_RESULT: "${{ needs.sonar-quality-gate.result }}" });
    for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
      const output = await new Deno.Command("bash", {
        args: ["-c", String(guard.run)],
        env: { SONAR_RESULT: result },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, result === "success" ? 0 : 1);
    }
  });
});

it("diagnoses failed RC publishing without building or executing installed packages", async () => {
  const jobs = await readJobs();
  const registry = asRecord(jobs["registry-validation-rc"], "RC registry job");
  const diagnostic = namedStep(registry, "Diagnose failed RC publish");
  assertEquals(diagnostic.if, "${{ needs.prerelease.result != 'success' }}");
  for (const name of ["Build registry validation image", "Validate exact registry release"]) {
    assertEquals(namedStep(registry, name).if, "${{ needs.prerelease.result == 'success' }}");
  }
  for (
    const required of [
      "diagnoseRegistryPackages",
      "--user 1000:1000",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges=true",
      "--network=bridge",
      "target=/source,readonly",
      "runtimePackages",
      "npm?.publish === false",
    ]
  ) {
    assertStringIncludes(String(diagnostic.run), required);
  }
  assertEquals(String(diagnostic.run).includes("docker build"), false);
  assertEquals(String(diagnostic.run).includes("npm install"), false);
  assertEquals(
    asRecord(diagnostic.env, "diagnostic env").RC_VERSION,
    "${{ needs.prerelease.outputs.version }}",
  );
});
