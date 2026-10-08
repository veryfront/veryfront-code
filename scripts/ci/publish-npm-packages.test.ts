import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { parse } from "#std/yaml/parse";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";

const scriptPath = `${Deno.cwd()}/scripts/ci/publish-npm-packages.sh`;
const decoder = new TextDecoder();

async function sha256File(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function writeCanonicalTarballArtifact(
  stateDir: string,
  artifactDir: string,
  gitHead?: string,
): Promise<void> {
  const packageRoot = `${stateDir}/staging/package`;
  const tarball = `${artifactDir}/veryfront-0.1.0.tgz`;
  await Deno.mkdir(packageRoot, { recursive: true });
  await Deno.mkdir(artifactDir);
  await Deno.writeTextFile(
    `${packageRoot}/package.json`,
    JSON.stringify({
      name: "veryfront",
      version: "0.1.0",
      ...(gitHead === undefined ? {} : { gitHead }),
    }),
  );
  const tar = await new Deno.Command("tar", {
    args: ["-czf", tarball, "package"],
    cwd: `${stateDir}/staging`,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(tar.code, 0, decoder.decode(tar.stderr));
  await Deno.writeTextFile(
    `${artifactDir}/manifest.json`,
    JSON.stringify({
      schemaVersion: 1,
      rootPackage: "veryfront",
      rootExtensionNames: [],
      packages: [{
        name: "veryfront",
        version: "0.1.0",
        file: "veryfront-0.1.0.tgz",
        sha256: await sha256File(tarball),
      }],
    }),
  );
}

async function runBash(
  source: string,
  env: Record<string, string>,
): Promise<Deno.CommandOutput> {
  return await new Deno.Command("bash", {
    args: ["-c", source],
    env: { ...env, SCRIPT_PATH: scriptPath },
    stdout: "piped",
    stderr: "piped",
  }).output();
}

interface PackageFixture {
  packageDir: string;
  npmLog: string;
}

async function withPackageFixture(
  packageName: string,
  fn: (fixture: PackageFixture) => Promise<void>,
): Promise<void> {
  await withTempDir(async (stateDir) => {
    const packageDir = `${stateDir}/package`;
    const npmLog = `${stateDir}/npm.log`;
    await Deno.mkdir(packageDir);
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: packageName }),
    );
    await Deno.writeTextFile(npmLog, "");
    await fn({ packageDir, npmLog });
  });
}

const LOG_NPM_CALL = '  printf "%s\\n" "$*" >> "$NPM_LOG"';

// Compose a release-publish run whose npm mock logs every call to $NPM_LOG.
function releasePublishScript(npmMockBody: string[]): string {
  return [
    "set -euo pipefail",
    'source "$SCRIPT_PATH"',
    "npm() {",
    LOG_NPM_CALL,
    ...npmMockBody,
    "}",
    "sleep() { :; }",
    'release_publish_package_dir "$PACKAGE_DIR"',
  ].join("\n");
}

async function loggedNpmCalls(npmLog: string): Promise<string[]> {
  return (await Deno.readTextFile(npmLog)).trim().split("\n");
}

function shellFailureDiagnostics(
  output: Deno.CommandOutput,
  packageDir: string,
  npmLog: string,
): string {
  const sanitize = (text: string): string =>
    text
      .replace(/Bearer\s+[^\s]+/g, "Bearer <REDACTED>")
      .replace(/([?&]token=|_authToken=)[^\s&]+/g, "$1<REDACTED>")
      .replaceAll(packageDir, "<package>")
      .replaceAll(npmLog, "<npm-log>")
      .replaceAll(scriptPath, "<publish-script>");
  const bound = (text: string): string =>
    text.length > 2_048 ? `${text.slice(0, 1_024)}\n<omitted>\n${text.slice(-1_024)}` : text;
  return `shell exit=${output.code}\nstdout:\n${
    bound(sanitize(decoder.decode(output.stdout)))
  }\nstderr:\n${bound(sanitize(decoder.decode(output.stderr)))}`;
}

describe("npm package publishing", () => {
  for (
    const [current, candidate, expectedTag] of [
      ["0.1.2-rc.201", "0.1.2-rc.200", "rc-history"],
      ["0.1.2-rc.200", "0.1.2-rc.201", "rc"],
      ["0.1.2-rc.201", "0.1.2-rc.201", "rc"],
      ["0.1.10-rc.1", "0.1.9-rc.999", "rc-history"],
      ["0.1.2-rc.1000", "0.1.2-rc.999", "rc-history"],
      ["", "0.1.2-rc.200", "rc"],
      ["0.1.2-beta.201", "0.1.2-beta.200", "rc-history"],
      ["0.1.2-rc.preview.200", "0.1.2-rc.preview.201", "rc"],
      ["0.1.2-alpha.10.200", "0.1.2-alpha.9.999", "rc-history"],
      ["0.1.2-beta.200", "0.1.2-rc.1", "rc"],
      ["0.1.2-rc.preview.200", "0.1.2-rc.999", "rc-history"],
      ["0.1.2-rc.1.200", "0.1.2-rc.1.preview.1", "rc"],
    ]
  ) {
    it(`keeps rc monotonic when ${candidate} follows ${current || "no tag"}`, async () => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'npm() { echo "$CURRENT_TAGS"; }',
          "rc_tag_for_package veryfront",
        ].join("\n"),
        { CURRENT_TAGS: current ? `rc: ${current}` : "", VERSION: candidate! },
      );
      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(decoder.decode(output.stdout).trim(), expectedTag);
    });
  }

  it("fails closed on an unavailable rc tag lookup", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        'npm() { echo "npm error code E503" >&2; return 1; }',
        "rc_tag_for_package veryfront",
      ].join("\n"),
      { VERSION: "0.1.2-rc.200" },
    );
    assertEquals(output.code, 1);
    assertStringIncludes(decoder.decode(output.stderr), "rc tag lookup failed");
  });

  for (const current of ["0.1.2", "0.1.2-rc..200", "0.1.2-rc.0201"]) {
    it(`rejects unexpected rc tag ${current}`, async () => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'npm() { echo "$CURRENT_TAGS"; }',
          "rc_tag_for_package veryfront",
        ].join("\n"),
        { CURRENT_TAGS: `rc: ${current}`, VERSION: "0.1.2-rc.200" },
      );
      assertEquals(output.code === 0, false);
    });
  }

  it("publishes an older immutable RC after a newer one without moving rc backwards", async () => {
    await withPackageFixture("veryfront", async ({ packageDir, npmLog }) => {
      const tagState = `${packageDir}/rc-tag`;
      await Deno.writeTextFile(tagState, "");
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "verify_npm_compatibility_artifact() { :; }",
          'package_dirs() { echo "$PACKAGE_DIR"; }',
          'canonical_tarball_for_package_dir() { echo "candidate-$VERSION.tgz"; }',
          'curl() { printf \'%s\\n\' "$(jq -n --arg version "$VERSION" --arg head "$GITHUB_SHA" \'{name:"veryfront",version:$version,gitHead:$head}\')" 200; }',
          "npm() {",
          LOG_NPM_CALL,
          '  if [ "$1" = config ]; then echo https://registry.npmjs.org/; return; fi',
          '  if [ "$1" = dist-tag ]; then tag=$(cat "$TAG_STATE"); if [ -n "$tag" ]; then echo "rc: $tag"; fi; return 0; fi',
          '  if [ "$1" = view ]; then if [ "$3" = gitHead ]; then echo "$GITHUB_SHA"; return 0; fi; return 1; fi',
          '  if [ "${!#}" = rc ]; then echo "$VERSION" > "$TAG_STATE"; fi',
          "}",
          "VERSION=0.1.2-rc.201; run_rc_publish",
          "VERSION=0.1.2-rc.200; run_rc_publish",
        ].join("\n"),
        {
          PACKAGE_DIR: packageDir,
          NPM_LOG: npmLog,
          TAG_STATE: tagState,
          NPM_PACK_DIR: packageDir,
          GITHUB_SHA: "expected-commit",
        },
      );
      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals((await Deno.readTextFile(tagState)).trim(), "0.1.2-rc.201");
      assertEquals(
        (await loggedNpmCalls(npmLog)).filter((call) => call.startsWith("publish ")),
        [
          "publish candidate-0.1.2-rc.201.tgz --provenance --access public --tag rc",
          "publish candidate-0.1.2-rc.200.tgz --provenance --access public --tag rc-history",
        ],
      );
    });
  });

  it("waits for the RC tag write before releasing the publisher lock", async () => {
    await withTempDir(async (stateDir) => {
      const count = `${stateDir}/reads`;
      await Deno.writeTextFile(count, "0");
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "sleep() { :; }",
          'curl() { printf \'%s\\n\' "$(jq -n --arg version "$VERSION" --arg head "$GITHUB_SHA" \'{name:"veryfront",version:$version,gitHead:$head}\')" 200; }',
          "npm() {",
          '  if [ "$1" = config ]; then echo https://registry.npmjs.org/; return; fi',
          '  n=$(cat "$READ_COUNT"); n=$((n + 1)); echo "$n" > "$READ_COUNT"',
          `  if [ "$n" -eq 1 ]; then echo 'rc: 0.1.2-rc.200'; else echo 'rc: 0.1.2-rc.201'; fi`,
          "}",
          "wait_for_npm_git_head veryfront rc",
        ].join("\n"),
        {
          VERSION: "0.1.2-rc.201",
          GITHUB_SHA: "expected-commit",
          READ_COUNT: count,
          NPM_GIT_HEAD_WAIT_ATTEMPTS: "2",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "0",
        },
      );
      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals((await Deno.readTextFile(count)).trim(), "2");
    });
  });

  it("publishes the canonical tarball without repacking the materialized package", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/npm`;
      const artifactDir = `${stateDir}/artifact`;
      const tarball = `${artifactDir}/veryfront-0.1.0.tgz`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.mkdir(artifactDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "veryfront", version: "0.1.0" }),
      );
      await Deno.writeTextFile(tarball, "canonical tarball bytes");
      await Deno.writeTextFile(
        `${artifactDir}/manifest.json`,
        JSON.stringify({
          packages: [{
            name: "veryfront",
            version: "0.1.0",
            file: "veryfront-0.1.0.tgz",
            sha256: "0".repeat(64),
          }],
        }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "verify_npm_compatibility_artifact() { :; }",
          "package_dirs() { printf '%s\\n' \"$PACKAGE_DIR\"; }",
          "update_package_version() { return 97; }",
          "rc_tag_for_package() { echo rc; }",
          "wait_for_npm_git_head() { return 0; }",
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ]; then return 1; fi',
          "}",
          "run_rc_publish",
        ].join("\n"),
        {
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PACK_DIR: artifactDir,
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        (await Deno.readTextFile(npmLog)).trim().split("\n"),
        [
          "view veryfront@0.1.0 version",
          `publish ${tarball} --provenance --access public --tag rc`,
        ],
      );
    });
  });

  for (
    const publishFunction of [
      "rc_publish_package_dir",
      "release_publish_package_dir",
    ]
  ) {
    it(`sanitizes failed npm publish output from ${publishFunction}`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/package`;
        await Deno.mkdir(packageDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
        );

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "npm() {",
            '  if [ "$1" = "view" ]; then return 1; fi',
            '  printf "%s\\n" "npm error auth Bearer fixture-publish-token" >&2',
            '  printf "%s\\n" "npm error cache=/tmp/npm-private/publish.log" >&2',
            "  return 42",
            "}",
            `${publishFunction} "$PACKAGE_DIR"`,
          ].join("\n"),
          {
            GITHUB_SHA: "expected-commit",
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.1069",
          },
        );

        const combinedOutput = decoder.decode(
          new Uint8Array([...output.stdout, ...output.stderr]),
        );
        assertEquals(output.code, 42, combinedOutput);
        assertStringIncludes(combinedOutput, "Bearer <REDACTED>");
        assertStringIncludes(combinedOutput, "cache=<path>");
        assertEquals(combinedOutput.includes("fixture-publish-token"), false);
        assertEquals(combinedOutput.includes("/tmp/npm-private"), false);
      });
    });
  }

  for (const publishFunction of ["run_rc_publish", "run_release_publish"]) {
    it(`blocks ${publishFunction} before publish when canonical artifact verification fails`, async () => {
      await withTempDir(async (stateDir) => {
        const artifactDir = `${stateDir}/artifact`;
        const tarball = `${artifactDir}/veryfront-0.1.0.tgz`;
        const callLog = `${stateDir}/calls.log`;
        await Deno.mkdir(artifactDir);
        await Deno.writeTextFile(tarball, "tampered tarball bytes");
        await Deno.writeTextFile(
          `${artifactDir}/manifest.json`,
          JSON.stringify({
            schemaVersion: 1,
            rootPackage: "veryfront",
            rootExtensionNames: [],
            packages: [{
              name: "veryfront",
              version: "0.1.0",
              file: "veryfront-0.1.0.tgz",
              sha256: "0".repeat(64),
            }],
          }),
        );
        await Deno.writeTextFile(callLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            'package_dirs() { printf "%s\\n" "package_dirs" >> "$CALL_LOG"; }',
            'npm() { printf "%s\\n" "npm $*" >> "$CALL_LOG"; }',
            publishFunction,
          ].join("\n"),
          {
            CALL_LOG: callLog,
            GITHUB_SHA: "expected-commit",
            NPM_PACK_DIR: artifactDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(output.code, 1, decoder.decode(output.stderr));
        assertStringIncludes(
          decoder.decode(output.stderr),
          "npm compatibility artifact verify failed.",
        );
        assertStringIncludes(
          decoder.decode(output.stderr),
          "Canonical npm compatibility artifact verification failed",
        );
        assertEquals(
          await Deno.readTextFile(callLog),
          "",
          "Verification must fail before package enumeration or npm publish",
        );
      });
    });
  }

  for (const publishFunction of ["run_rc_publish", "run_release_publish"]) {
    for (const artifactGitHead of [undefined, "f".repeat(40)]) {
      const identityCase = artifactGitHead === undefined ? "missing" : "mismatched";
      it(`blocks ${publishFunction} before publish when canonical tarball gitHead is ${identityCase}`, async () => {
        await withTempDir(async (stateDir) => {
          const packageDir = `${stateDir}/npm`;
          const artifactDir = `${stateDir}/artifact`;
          const callLog = `${stateDir}/calls.log`;
          await Deno.mkdir(packageDir);
          await Deno.writeTextFile(
            `${packageDir}/package.json`,
            JSON.stringify({ name: "veryfront", version: "0.1.0" }),
          );
          await writeCanonicalTarballArtifact(
            stateDir,
            artifactDir,
            artifactGitHead,
          );
          await Deno.writeTextFile(callLog, "");

          const output = await runBash(
            [
              "set -euo pipefail",
              'source "$SCRIPT_PATH"',
              'package_dirs() { printf "%s\\n" "package_dirs" >> "$CALL_LOG"; }',
              'npm() { printf "%s\\n" "npm $*" >> "$CALL_LOG"; }',
              publishFunction,
            ].join("\n"),
            {
              CALL_LOG: callLog,
              GITHUB_SHA: "0".repeat(40),
              NPM_PACK_DIR: artifactDir,
              VERSION: "0.1.0",
            },
          );

          assertEquals(output.code, 1, decoder.decode(output.stderr));
          assertStringIncludes(
            decoder.decode(output.stderr),
            "Canonical npm compatibility artifact verification failed",
          );
          assertEquals(
            await Deno.readTextFile(callLog),
            "",
            "Commit identity verification must fail before package enumeration or npm publish",
          );
        });
      });
    }
  }

  for (const publishFunction of ["run_rc_publish", "run_release_publish"]) {
    it(`blocks ${publishFunction} when the manifest omits a package`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/npm`;
        const artifactDir = `${stateDir}/artifact`;
        const npmLog = `${stateDir}/npm.log`;
        await Deno.mkdir(packageDir);
        await Deno.mkdir(artifactDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "veryfront", version: "0.1.0" }),
        );
        await Deno.writeTextFile(
          `${artifactDir}/manifest.json`,
          JSON.stringify({ packages: [] }),
        );
        await Deno.writeTextFile(npmLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "verify_npm_compatibility_artifact() { :; }",
            "package_dirs() { printf '%s\\n' \"$PACKAGE_DIR\"; }",
            'npm() { printf "%s\\n" "$*" >> "$NPM_LOG"; }',
            publishFunction,
          ].join("\n"),
          {
            GITHUB_SHA: "expected-commit",
            NPM_LOG: npmLog,
            NPM_PACK_DIR: artifactDir,
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(output.code, 1, decoder.decode(output.stderr));
        assertStringIncludes(
          decoder.decode(output.stderr),
          "Canonical npm publish spec for veryfront is empty",
        );
        assertEquals(
          await Deno.readTextFile(npmLog),
          "",
          "A package missing from the manifest must fail before npm publish",
        );
      });
    });
  }

  it("tolerates npm gitHead metadata appearing after 120 seconds", async () => {
    const stateDir = await Deno.makeTempDir();
    const countFile = `${stateDir}/npm-view-count`;
    await Deno.writeTextFile(countFile, "0");

    try {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          '  if [ "$count" -ge 26 ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "  fi",
          "}",
          "sleep() { :; }",
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt"',
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(await Deno.readTextFile(countFile), "26");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  });

  it("fails fast when npm reports a wrong non-empty gitHead", async () => {
    const stateDir = await Deno.makeTempDir();
    const countFile = `${stateDir}/npm-view-count`;
    const sleepFile = `${stateDir}/sleep-count`;
    await Deno.writeTextFile(countFile, "0");
    await Deno.writeTextFile(sleepFile, "0");

    try {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          '  printf "%s\\n" "wrong-commit"',
          "}",
          "sleep() {",
          '  count="$(cat "$SLEEP_FILE")"',
          '  printf "%s" "$((count + 1))" > "$SLEEP_FILE"',
          "}",
          'if wait_for_npm_git_head "@veryfront/ext-auth-jwt"; then',
          "  exit 91",
          "fi",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          SLEEP_FILE: sleepFile,
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(await Deno.readTextFile(countFile), "1");
      assertEquals(await Deno.readTextFile(sleepFile), "0");
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  });

  it("rejects an RC rerun when the existing version has a mismatched gitHead", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "wrong-commit"',
          "    return 0",
          "  fi",
          "  return 92",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 1, decoder.decode(output.stderr));
      assertStringIncludes(
        decoder.decode(output.stderr),
        "gitHead does not match this commit",
      );
      assertEquals(
        (await Deno.readTextFile(npmLog)).trim().split("\n"),
        [
          "view @veryfront/ext-auth-jwt@0.1.1069 version",
          "view @veryfront/ext-auth-jwt@0.1.1069 gitHead",
        ],
      );
    });
  });

  // A stable publish on 2026-09-21 landed 58 minutes after `npm publish` started
  // and its gitHead metadata appeared 43 seconds after a five-minute wait gave
  // up, so the release failed after npm had already published the version.
  it("tolerates npm gitHead metadata appearing after the former five-minute window", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      await Deno.writeTextFile(countFile, "0");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          '  if [ "$count" -ge 100 ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "  fi",
          "}",
          "sleep() { :; }",
          'wait_for_npm_git_head "veryfront"',
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1260",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(await Deno.readTextFile(countFile), "100");
    });
  });

  it("bounds the gitHead metadata wait by NPM_GIT_HEAD_WAIT_ATTEMPTS", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      await Deno.writeTextFile(countFile, "0");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          "}",
          "sleep() { :; }",
          'if wait_for_npm_git_head "veryfront"; then exit 0; else exit 7; fi',
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1260",
          NPM_GIT_HEAD_WAIT_ATTEMPTS: "3",
        },
      );

      assertEquals(output.code, 7);
      // Three polling reads plus the final confirmation read.
      assertEquals(await Deno.readTextFile(countFile), "4");
    });
  });

  it("shares one gitHead metadata deadline across every package in a release", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      await Deno.writeTextFile(countFile, "0");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          "}",
          "sleep() { :; }",
          // The shared budget is already spent, so neither package polls again:
          // each makes one read plus the final confirmation read.
          'wait_for_npm_git_head "veryfront" && exit 3',
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt" && exit 4',
          "exit 0",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "0",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(await Deno.readTextFile(countFile), "4");
    });
  });

  it("defaults the shared metadata budget to cover a full release at normal registry pace", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        'printf "%s %s" "$NPM_GIT_HEAD_WAIT_TOTAL_SECONDS" "$NPM_GIT_HEAD_WAIT_DELAY_SECONDS"',
      ].join("\n"),
      {},
    );
    assertEquals(output.code, 0, decoder.decode(output.stderr));
    const [totalSeconds, delaySeconds] = decoder.decode(output.stdout).split(" ").map(Number);
    // 0.1.1261 needed up to 19 metadata polls per package and spent the old
    // 30-minute budget on its first 21 packages; a release publishes ~30.
    const slowestNormalPackageSeconds = 19 * delaySeconds;
    const releasePackageCount = 30;
    assertEquals(
      totalSeconds >= releasePackageCount * slowestNormalPackageSeconds,
      true,
      `budget ${totalSeconds}s`,
    );
    // Still bounded well under GitHub's 6-hour default job limit.
    assertEquals(totalSeconds <= 4 * 60 * 60, true, `budget ${totalSeconds}s`);
  });

  it("counts only time spent waiting against the shared metadata budget", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      await Deno.writeTextFile(countFile, "0");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          "}",
          "sleep() { :; }",
          // Wall-clock time (for example spent publishing other packages) must
          // not consume the budget: a clock that jumps far ahead changes nothing.
          "date() { echo 9999999999; }",
          // 20s budget at 10s per wait: the first package polls twice, then
          // the second package gets only its initial read and a confirmation.
          'wait_for_npm_git_head "veryfront" && exit 3',
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt" && exit 4',
          "exit 0",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "20",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "10",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      // Package 1: 3 polling reads + 1 confirmation; package 2: 1 read + 1 confirmation.
      assertEquals(await Deno.readTextFile(countFile), "6");
    });
  });

  it("charges slow registry lookups to the shared metadata budget", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      const clockFile = `${stateDir}/clock`;
      await Deno.writeTextFile(countFile, "0");
      await Deno.writeTextFile(clockFile, "1000");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          // Each registry lookup takes 50 seconds on the stubbed clock.
          '  clock="$(cat "$CLOCK_FILE")"',
          '  printf "%s" "$((clock + 50))" > "$CLOCK_FILE"',
          "}",
          "sleep() { :; }",
          'date() { cat "$CLOCK_FILE"; }',
          // 120s budget, 10s per wait: lookups 50+10, 50+10, then 50 spends it.
          'wait_for_npm_git_head "veryfront" && exit 3',
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt" && exit 4',
          "exit 0",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          CLOCK_FILE: clockFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "120",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "10",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      // Package 1: 3 polling reads + 1 confirmation; package 2: 1 read + 1 confirmation.
      assertEquals(await Deno.readTextFile(countFile), "6");
    });
  });

  it("charges successful slow lookups to the shared metadata budget", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      const clockFile = `${stateDir}/clock`;
      await Deno.writeTextFile(countFile, "0");
      await Deno.writeTextFile(clockFile, "1000");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          '  clock="$(cat "$CLOCK_FILE")"',
          '  printf "%s" "$((clock + 50))" > "$CLOCK_FILE"',
          // The first package resolves (slowly); the second stays empty.
          '  if [ "$2" = "veryfront@${VERSION}" ]; then printf "%s\\n" "$GITHUB_SHA"; fi',
          "}",
          "sleep() { :; }",
          'date() { cat "$CLOCK_FILE"; }',
          'wait_for_npm_git_head "veryfront" || exit 3',
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt" && exit 4',
          "exit 0",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          CLOCK_FILE: clockFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "60",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "10",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      // Package 1's successful 50s lookup is charged, so package 2's first 50s
      // lookup spends the 60s budget: one read plus the confirmation.
      assertEquals(await Deno.readTextFile(countFile), "3");
    });
  });

  it("bounds every metadata lookup with a fetch timeout and a single retry", async () => {
    await withTempDir(async (stateDir) => {
      const npmLog = `${stateDir}/npm.log`;
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'npm() { printf "%s\\n" "$*" >> "$NPM_LOG"; }',
          "sleep() { :; }",
          'wait_for_npm_git_head "veryfront" && exit 3',
          "exit 0",
        ].join("\n"),
        {
          NPM_LOG: npmLog,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_ATTEMPTS: "1",
          NPM_GIT_HEAD_LOOKUP_TIMEOUT_MS: "45000",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals((await Deno.readTextFile(npmLog)).trim().split("\n"), [
        "view veryfront@0.1.1261 gitHead --fetch-timeout=45000 --fetch-retries=1",
        "view veryfront@0.1.1261 gitHead --fetch-timeout=45000 --fetch-retries=1",
      ]);
    });
  });

  it("charges the final confirmation lookup to the shared metadata budget", async () => {
    await withTempDir(async (stateDir) => {
      const countFile = `${stateDir}/npm-view-count`;
      const clockFile = `${stateDir}/clock`;
      await Deno.writeTextFile(countFile, "0");
      await Deno.writeTextFile(clockFile, "1000");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  count="$(cat "$COUNT_FILE")"',
          "  count=$((count + 1))",
          '  printf "%s" "$count" > "$COUNT_FILE"',
          '  clock="$(cat "$CLOCK_FILE")"',
          '  printf "%s" "$((clock + 50))" > "$CLOCK_FILE"',
          "}",
          "sleep() { :; }",
          'date() { cat "$CLOCK_FILE"; }',
          'wait_for_npm_git_head "veryfront" && exit 3',
          'wait_for_npm_git_head "@veryfront/ext-auth-jwt" && exit 4',
          "exit 0",
        ].join("\n"),
        {
          COUNT_FILE: countFile,
          CLOCK_FILE: clockFile,
          GITHUB_SHA: "expected-commit",
          VERSION: "0.1.1261",
          NPM_GIT_HEAD_WAIT_ATTEMPTS: "2",
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "200",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "10",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      // Package 1: 2 polling reads + a charged 50s confirmation (170s spent);
      // package 2: its first read spends the budget, then one confirmation.
      assertEquals(await Deno.readTextFile(countFile), "5");
    });
  });

  it("waits for an existing RC version's missing gitHead metadata", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    if [ "$(grep -c gitHead "$NPM_LOG")" -lt 4 ]; then return 0; fi',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 92",
          "}",
          "sleep() { :; }",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertStringIncludes(
        decoder.decode(output.stdout),
        "already published for this commit; skipping npm publish",
      );
      const calls = (await Deno.readTextFile(npmLog)).trim().split("\n");
      assertEquals(
        calls.filter((line) => line.startsWith("publish")).length,
        0,
      );
      assertEquals(calls.filter((line) => / gitHead( |$)/.test(line)).length, 4);
    });
  });

  it("reports a sanitized npm lookup failure when an existing RC version gitHead cannot be read", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
      );

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  printf "%s\\n" "npm error code E503" >&2',
          '  printf "%s\\n" "npm error auth Bearer fixture-lookup-token" >&2',
          '  printf "%s\\n" "npm error cache=/tmp/npm-private/git-head.log" >&2',
          "  return 42",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.1069",
        },
      );

      const stderr = decoder.decode(output.stderr);
      assertEquals(output.code, 42, stderr);
      assertStringIncludes(
        stderr,
        "npm registry gitHead lookup failed for @veryfront/ext-auth-jwt@0.1.1069 (status 42)",
      );
      assertStringIncludes(stderr, "npm error code E503");
      assertStringIncludes(stderr, "Bearer <REDACTED>");
      assertStringIncludes(stderr, "cache=<path>");
      assertEquals(stderr.includes("fixture-lookup-token"), false);
      assertEquals(stderr.includes("/tmp/npm-private"), false);
      assertEquals(
        stderr.includes("gitHead does not match this commit"),
        false,
      );
    });
  });

  it("skips an RC package already published for the same commit", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 92",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(
        (await Deno.readTextFile(npmLog)).trim().split("\n"),
        [
          "view @veryfront/ext-auth-jwt@0.1.1069 version",
          "view @veryfront/ext-auth-jwt@0.1.1069 gitHead",
        ],
      );
      assertStringIncludes(
        decoder.decode(output.stdout),
        "already published for this commit; skipping npm publish",
      );
    });
  });

  it("does not recover a package already published for the commit on a release rerun", async () => {
    const stateDir = await Deno.makeTempDir();
    const packageDir = `${stateDir}/package`;
    const npmLog = `${stateDir}/npm.log`;
    await Deno.mkdir(packageDir);
    await Deno.writeTextFile(
      `${packageDir}/package.json`,
      JSON.stringify({ name: "@veryfront/ext-auth-jwt" }),
    );
    await Deno.writeTextFile(npmLog, "");

    try {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          '  printf "%s\\n" "previously published versions: $VERSION"',
          "  return 92",
          "}",
          "sleep() { return 93; }",
          'release_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.1069",
        },
      );

      assertEquals(output.code, 92, decoder.decode(output.stderr));
      const calls = (await Deno.readTextFile(npmLog)).trim().split("\n");
      assertEquals(calls, [
        `publish ${packageDir} --provenance --access public`,
      ]);
      assertEquals(
        decoder.decode(output.stdout).includes("skipping npm publish"),
        false,
      );
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  });

  it("rejects an E404 unbootstrapped package name during release preflight", async () => {
    const stateDir = await Deno.makeTempDir();
    const npmLog = `${stateDir}/npm.log`;
    await Deno.writeTextFile(npmLog, "");

    try {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "package_names_from_workspace() {",
          '  printf "%s\\n" "@veryfront/ext-existing" "@veryfront/ext-new"',
          "}",
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$2" = "@veryfront/ext-existing@*" ] && [ "$3" = "name" ]; then',
          '    printf "%s\\n" "@veryfront/ext-existing"',
          "    return 0",
          "  fi",
          '  printf "%s\\n" "npm error code E404" >&2',
          '  printf "%s\\n" "npm error 404 Not Found - GET https://registry.npmjs.org/@veryfront%2fext-new - Not found" >&2',
          "  return 1",
          "}",
          "run_preflight",
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          VERSION: "0.1.1189",
        },
      );

      assertEquals(output.code, 1, decoder.decode(output.stderr));
      assertStringIncludes(
        decoder.decode(output.stderr),
        "@veryfront/ext-new is not registered on npm",
      );
      assertStringIncludes(
        decoder.decode(output.stderr),
        "Publish each package once with a prerelease version and a non-latest dist-tag",
      );
      assertEquals(
        decoder.decode(output.stderr).includes("npm registry lookup failed"),
        false,
      );
      const calls = (await Deno.readTextFile(npmLog)).trim().split("\n");
      assertEquals(calls, [
        "view @veryfront/ext-existing@* name",
        "view @veryfront/ext-new@* name",
      ]);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  });

  it("reports sanitized non-E404 registry lookup failures", async () => {
    const stateDir = await Deno.makeTempDir();
    const npmLog = `${stateDir}/npm.log`;
    await Deno.writeTextFile(npmLog, "");

    try {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "package_names_from_workspace() {",
          '  printf "%s\\n" "@veryfront/ext-existing" "@veryfront/ext-flaky"',
          "}",
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "view" ] && [ "$2" = "@veryfront/ext-existing@*" ] && [ "$3" = "name" ]; then',
          '    printf "%s\\n" "@veryfront/ext-existing"',
          "    return 0",
          "  fi",
          '  printf "%s\\n" "npm error code E503" >&2',
          '  printf "%s\\n" "npm error 503 Service Unavailable" >&2',
          '  printf "%s\\n" "npm error auth Bearer fixture-token_~-/+=" >&2',
          '  printf "%s\\n" "npm error quoted-bearer=\\"Bearer fixture-token_~-/+=\\"" >&2',
          '  printf "%s\\n" "npm error comma-bearer=Bearer fixture-token_~-/+=," >&2',
          '  printf "%s\\n" "npm error quoted-url=\\"https://registry.npmjs.org/?token=fixture-token_~-/+=\\"" >&2',
          '  printf "%s\\n" "npm error comma-url=https://registry.npmjs.org/?token=fixture-token_~-/+=," >&2',
          '  printf "%s\\n" "npm error quoted-auth=\\"_authToken=fixture-token_~-/+=\\"" >&2',
          '  printf "%s\\n" "npm error comma-auth=_authToken=fixture-token_~-/+=," >&2',
          '  printf "%s\\n" "npm error cache=/tmp/npm-private/cache.log" >&2',
          '  printf "%s\\n" "npm error quoted=\\"/tmp/npm-private/quoted.log\\"" >&2',
          '  printf "%s\\n" "npm error paren-posix=(/tmp/npm-private/paren.log)" >&2',
          '  printf "%s\\n" "npm error comma-posix=/tmp/npm-private/comma.log," >&2',
          '  printf "%s\\n" "npm error single-posix=\'/tmp/npm-private/single.log\'" >&2',
          '  printf "%s\\n" "npm error bracket-posix=[/tmp/npm-private/bracket.log]" >&2',
          '  printf "%s\\n" "npm error spaced-posix=\\"/tmp/npm private/spaced.log\\"" >&2',
          '  printf "%s\\n" "npm error file-posix=file:///tmp/npm-private/file.log" >&2',
          '  printf "%s\\n" "npm error paren-file=(file:///tmp/npm-private/paren.log)" >&2',
          '  printf "%s\\n" "npm error comma-file=file:///tmp/npm-private/comma.log," >&2',
          '  printf "%s\\n" "npm error file-windows=file:///C:/Users/runner/file.log" >&2',
          '  printf "%s\\n" "npm error config C:\\\\Users\\\\runner\\\\.npmrc" >&2',
          '  printf "%s\\n" "npm error quoted-win=\\"C:\\\\Users\\\\runner\\\\quoted.log\\"" >&2',
          '  printf "%s\\n" "npm error paren-win=(C:\\\\Users\\\\runner\\\\paren.log)" >&2',
          '  printf "%s\\n" "npm error comma-win=C:\\\\Users\\\\runner\\\\comma.log," >&2',
          '  printf "%s\\n" "npm error single-win=\'C:\\\\Users\\\\CI Runner\\\\single.log\'" >&2',
          '  printf "%s\\n" "npm error workspace D:/build/private/package" >&2',
          '  printf "%s\\n" "npm error share \\\\\\\\server\\\\private\\\\debug.log" >&2',
          '  printf "%s\\n" "npm error quoted-share=\\"\\\\\\\\server\\\\private\\\\quoted.log\\"" >&2',
          '  printf "%s\\n" "npm error paren-share=(\\\\\\\\server\\\\private\\\\paren.log)" >&2',
          '  printf "%s\\n" "npm error comma-share=\\\\\\\\server\\\\private\\\\comma.log," >&2',
          '  printf "%s\\n" "npm error registry https://registry.npmjs.org/@veryfront%2fext-flaky" >&2',
          '  printf "%s\\n" "npm error A complete log of this run can be found in: /Users/runner/.npm/_logs/debug.log" >&2',
          "  return 42",
          "}",
          "run_preflight",
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          VERSION: "0.1.1189",
        },
      );

      assertEquals(output.code, 1, decoder.decode(output.stderr));
      const stderr = decoder.decode(output.stderr);
      assertStringIncludes(
        stderr,
        "npm registry lookup failed for @veryfront/ext-flaky (status 42)",
      );
      assertStringIncludes(stderr, "npm error code E503");
      assertStringIncludes(stderr, "Bearer <REDACTED>");
      assertStringIncludes(stderr, 'quoted-bearer="Bearer <REDACTED>"');
      assertStringIncludes(stderr, "comma-bearer=Bearer <REDACTED>,");
      assertStringIncludes(
        stderr,
        'quoted-url="https://registry.npmjs.org/?token=<REDACTED>"',
      );
      assertStringIncludes(
        stderr,
        "comma-url=https://registry.npmjs.org/?token=<REDACTED>,",
      );
      assertStringIncludes(stderr, 'quoted-auth="_authToken=<REDACTED>"');
      assertStringIncludes(stderr, "comma-auth=_authToken=<REDACTED>,");
      assertStringIncludes(stderr, "cache=<path>");
      assertStringIncludes(stderr, 'quoted="<path>"');
      assertStringIncludes(stderr, "paren-posix=(<path>)");
      assertStringIncludes(stderr, "comma-posix=<path>,");
      assertStringIncludes(stderr, "single-posix='<path>'");
      assertStringIncludes(stderr, "bracket-posix=[<path>]");
      assertStringIncludes(stderr, 'spaced-posix="<path>"');
      assertStringIncludes(stderr, "file-posix=file://<path>");
      assertStringIncludes(stderr, "paren-file=(file://<path>)");
      assertStringIncludes(stderr, "comma-file=file://<path>,");
      assertStringIncludes(stderr, "file-windows=file://<path>");
      assertStringIncludes(stderr, "config <path>");
      assertStringIncludes(stderr, 'quoted-win="<path>"');
      assertStringIncludes(stderr, "paren-win=(<path>)");
      assertStringIncludes(stderr, "comma-win=<path>,");
      assertStringIncludes(stderr, "single-win='<path>'");
      assertStringIncludes(stderr, 'quoted-share="<path>"');
      assertStringIncludes(stderr, "paren-share=(<path>)");
      assertStringIncludes(stderr, "comma-share=<path>,");
      assertStringIncludes(
        stderr,
        "registry https://registry.npmjs.org/@veryfront%2fext-flaky",
      );
      assertEquals(stderr.includes("fixture-token"), false);
      assertEquals(stderr.includes("/tmp/"), false);
      assertEquals(stderr.includes("C:\\"), false);
      assertEquals(stderr.includes("D:/"), false);
      assertEquals(stderr.includes("\\\\server"), false);
      assertEquals(stderr.includes("is not registered on npm"), false);
      assertEquals(
        stderr.includes("Publish each package once with a prerelease version"),
        false,
      );
      assertEquals(stderr.includes("/Users/"), false);
      const calls = (await Deno.readTextFile(npmLog)).trim().split("\n");
      assertEquals(calls, [
        "view @veryfront/ext-existing@* name",
        "view @veryfront/ext-flaky@* name",
      ]);
    } finally {
      await Deno.remove(stateDir, { recursive: true });
    }
  });

  it("fails the release preflight when a version already exists, even for this commit", async () => {
    await withTempDir(async (stateDir) => {
      const npmLog = `${stateDir}/npm.log`;
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "package_names_from_workspace() {",
          '  printf "%s\\n" "@veryfront/ext-existing"',
          "}",
          "npm() {",
          LOG_NPM_CALL,
          '  if [ "$1" = "view" ] && [ "$3" = "name" ]; then',
          '    printf "%s\\n" "@veryfront/ext-existing"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          "run_preflight",
        ].join("\n"),
        {
          GITHUB_SHA: "expected-commit",
          NPM_LOG: npmLog,
          VERSION: "0.1.1189",
        },
      );

      assertEquals(output.code, 1, decoder.decode(output.stderr));
      assertStringIncludes(
        decoder.decode(output.stdout),
        "already exists on npm. Bump deno.json before releasing.",
      );
      const calls = await loggedNpmCalls(npmLog);
      assertEquals(calls, [
        "view @veryfront/ext-existing@* name",
        "view @veryfront/ext-existing@0.1.1189 version",
      ], "preflight must fail closed without consulting gitHead metadata");
    });
  });

  // npm answers a burst of publishes with `409 Conflict - Failed to save
  // packument`. The write sometimes still lands, so the publish path has to
  // recheck the registry and retry rather than failing the whole release.
  const CONFLICT_OUTPUT =
    "npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@veryfront%2fext-llm-google - Failed to save packument.";

  for (
    const publishFunction of [
      "rc_publish_package_dir",
      "release_publish_package_dir",
    ]
  ) {
    it(`retries a transient npm 409 conflict in ${publishFunction}`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/package`;
        const npmLog = `${stateDir}/npm.log`;
        await Deno.mkdir(packageDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "@veryfront/ext-llm-google" }),
        );
        await Deno.writeTextFile(npmLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "npm() {",
            '  printf "%s\\n" "$*" >> "$NPM_LOG"',
            '  if [ "$1" = "publish" ]; then',
            '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 1 ]; then',
            '      printf "%s\\n" "$CONFLICT_OUTPUT"',
            "      return 1",
            "    fi",
            "    return 0",
            "  fi",
            '  if [ "$1" = "view" ]; then',
            // no published version yet, so the conflict was a genuine failure
            '    if [ "$(grep -c "^publish" "$NPM_LOG")" -le 1 ]; then return 1; fi',
            '    printf "%s\\n" "$GITHUB_SHA"',
            "    return 0",
            "  fi",
            "}",
            `${publishFunction} "$PACKAGE_DIR"`,
          ].join("\n"),
          {
            CONFLICT_OUTPUT,
            GITHUB_SHA: "0".repeat(40),
            NPM_LOG: npmLog,
            NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(output.code, 0, decoder.decode(output.stderr));
        const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
          .filter((line) => line.startsWith("publish"));
        assertEquals(publishes.length, 2);
      });
    });
  }

  // The GitHub Actions OIDC endpoint that `--provenance` calls for each
  // publish separately can fail a single request under the same back-to-back
  // loop, without the publish ever reaching the registry.
  const IDENTITY_TOKEN_OUTPUT =
    "npm error code IDENTITY_TOKEN_READ_ERROR\nnpm error error retrieving identity token";

  for (
    const publishFunction of [
      "rc_publish_package_dir",
      "release_publish_package_dir",
    ]
  ) {
    it(`retries a transient npm identity token error in ${publishFunction}`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/package`;
        const npmLog = `${stateDir}/npm.log`;
        await Deno.mkdir(packageDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "@veryfront/ext-llm-google" }),
        );
        await Deno.writeTextFile(npmLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "npm() {",
            '  printf "%s\\n" "$*" >> "$NPM_LOG"',
            '  if [ "$1" = "publish" ]; then',
            '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 1 ]; then',
            '      printf "%s\\n" "$IDENTITY_TOKEN_OUTPUT"',
            "      return 1",
            "    fi",
            "    return 0",
            "  fi",
            '  if [ "$1" = "view" ]; then',
            // the publish never reached the registry, so it is still absent
            '    if [ "$(grep -c "^publish" "$NPM_LOG")" -le 1 ]; then return 1; fi',
            '    printf "%s\\n" "$GITHUB_SHA"',
            "    return 0",
            "  fi",
            "}",
            `${publishFunction} "$PACKAGE_DIR"`,
          ].join("\n"),
          {
            IDENTITY_TOKEN_OUTPUT,
            GITHUB_SHA: "0".repeat(40),
            NPM_LOG: npmLog,
            NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(output.code, 0, decoder.decode(output.stderr));
        const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
          .filter((line) => line.startsWith("publish"));
        assertEquals(publishes.length, 2);
      });
    });
  }

  it("classifies diagnostic-heavy identity-token failures without SIGPIPE", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        'is_transient_publish_failure "$IDENTITY_TOKEN_OUTPUT"',
        'is_identity_token_read_failure "$IDENTITY_TOKEN_OUTPUT"',
      ].join("\n"),
      {
        IDENTITY_TOKEN_OUTPUT: `${IDENTITY_TOKEN_OUTPUT}\n${"diagnostic ".repeat(10_000)}`,
      },
    );
    assertEquals(output.code, 0, `classifier shell exit=${output.code}`);
  });

  it("redacts credentials and fixture paths from shell assertion diagnostics", () => {
    const diagnostics = shellFailureDiagnostics(
      {
        code: 1,
        success: false,
        signal: null,
        stdout: new TextEncoder().encode(
          "Bearer fixture-secret\nhttps://registry.example/?token=fixture-secret\n_authToken=fixture-secret",
        ),
        stderr: new TextEncoder().encode(
          `${scriptPath}: /fixture/package /fixture/npm.log`,
        ),
      },
      "/fixture/package",
      "/fixture/npm.log",
    );
    assertStringIncludes(diagnostics, "shell exit=1");
    assertStringIncludes(diagnostics, "Bearer <REDACTED>");
    assertStringIncludes(diagnostics, "token=<REDACTED>");
    assertStringIncludes(diagnostics, "_authToken=<REDACTED>");
    assertStringIncludes(diagnostics, "<publish-script>: <package> <npm-log>");
    assertEquals(diagnostics.includes("fixture-secret"), false);
    assertEquals(diagnostics.includes("/fixture"), false);
  });

  for (
    const [suffix, identityOutput] of [
      ["", IDENTITY_TOKEN_OUTPUT],
      [
        " with diagnostic-heavy output",
        `${IDENTITY_TOKEN_OUTPUT}\n${
          "diagnostic ".repeat(10_000)
        }\nBearer fixture-secret\nhttps://registry.example/?token=fixture-secret\n_authToken=fixture-secret`,
      ],
    ]
  ) {
    it(`does not poll registry metadata after identity-token retries are exhausted${suffix}`, async () => {
      await withPackageFixture(
        "@veryfront/ext-llm-google",
        async ({ packageDir, npmLog }) => {
          const output = await runBash(
            [
              "set -euo pipefail",
              'source "$SCRIPT_PATH"',
              "npm() {",
              LOG_NPM_CALL,
              '  if [ "$1" = "publish" ]; then',
              '    printf "%s\\n" "$IDENTITY_TOKEN_OUTPUT"',
              "    return 1",
              "  fi",
              "  return 1",
              "}",
              "sleep() { :; }",
              'rc_publish_package_dir "$PACKAGE_DIR" || echo "EXIT=$?"',
            ].join("\n"),
            {
              IDENTITY_TOKEN_OUTPUT: identityOutput!,
              GITHUB_SHA: "0".repeat(40),
              NPM_LOG: npmLog,
              NPM_PUBLISH_CONFLICT_ATTEMPTS: "2",
              NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
              PACKAGE_DIR: packageDir,
              VERSION: "0.1.0",
            },
          );

          const diagnostics = shellFailureDiagnostics(
            output,
            packageDir,
            npmLog,
          );
          assertStringIncludes(
            decoder.decode(output.stdout),
            "EXIT=1",
            diagnostics,
          );
          const calls = await loggedNpmCalls(npmLog);
          assertEquals(
            calls.filter((line) => line.startsWith("publish ")).length,
            2,
            diagnostics,
          );
          assertEquals(
            calls.filter((line) => line.startsWith("view ")).length,
            7,
            diagnostics,
          );
          assertEquals(diagnostics.includes("fixture-secret"), false);
        },
      );
    });
  }

  it("accepts a 409 whose publish already landed in rc_publish_package_dir", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          LOG_NPM_CALL,
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          // not published before the attempt; the conflicting write did land
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then return 1; fi',
          '  if [ "$1" = "view" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 0 ]; then return 1; fi',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      const publishes = (await loggedNpmCalls(npmLog))
        .filter((line) => line.startsWith("publish"));
      assertEquals(publishes.length, 1);
    });
  });

  // The stable path must never accept a conflicted write through registry
  // metadata: gitHead is attacker-controllable, so an existing version after a
  // 409 fails the release even when the reported gitHead matches this commit.
  it("fails closed when a conflicted release publish lands on the registry", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        releasePublishScript([
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          // the conflicting write landed with a matching (spoofable) gitHead
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
        ]),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(
        output.code,
        1,
        "a stable release must fail closed once the conflicted version exists",
      );
      assertStringIncludes(
        decoder.decode(output.stderr),
        "Stable releases fail closed",
      );
      assertEquals(
        decoder.decode(output.stdout).includes("landed despite an npm registry conflict"),
        false,
        "an existing stable version must never be recovered via gitHead metadata",
      );
      const calls = await loggedNpmCalls(npmLog);
      assertEquals(
        calls.filter((line) => line.startsWith("publish")).length,
        1,
      );
      assertEquals(
        calls.filter((line) => line.endsWith("gitHead")).length,
        0,
        "fail-closed conflict handling must not consult gitHead metadata",
      );
    });
  });

  it("does not retry a non-conflict npm publish failure", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-llm-google" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "npm error code E403"',
          "    return 1",
          "  fi",
          '  if [ "$1" = "view" ]; then return 1; fi',
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR" || echo "EXIT=$?"',
        ].join("\n"),
        {
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertStringIncludes(decoder.decode(output.stdout), "EXIT=1");
      const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
        .filter((line) => line.startsWith("publish"));
      assertEquals(publishes.length, 1);
    });
  });

  it("gives up after the bounded number of conflict retries", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-llm-google" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          '  if [ "$1" = "view" ]; then return 1; fi',
          "}",
          "sleep() { :; }",
          'rc_publish_package_dir "$PACKAGE_DIR" || echo "EXIT=$?"',
        ].join("\n"),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_ATTEMPTS: "3",
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertStringIncludes(decoder.decode(output.stdout), "EXIT=1");
      const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
        .filter((line) => line.startsWith("publish"));
      assertEquals(publishes.length, 3);
    });
  });

  // The conflicting write can surface while the retry delay elapses. npm
  // refuses to reuse a published name/version, so a blind republish would turn
  // a recoverable conflict into a fatal already-published error. Only the RC
  // path may recover through gitHead; the stable path fails closed instead
  // (covered above).
  for (
    const [publishFunction, gitHeadVisibleAfter] of [
      ["rc_publish_package_dir", "1"],
    ]
  ) {
    it(`rechecks gitHead after the conflict delay in ${publishFunction}`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/package`;
        const npmLog = `${stateDir}/npm.log`;
        await Deno.mkdir(packageDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "@veryfront/ext-llm-google" }),
        );
        await Deno.writeTextFile(npmLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "npm() {",
            '  printf "%s\\n" "$*" >> "$NPM_LOG"',
            '  if [ "$1" = "publish" ]; then',
            '    printf "%s\\n" "$CONFLICT_OUTPUT"',
            "    return 1",
            "  fi",
            // gitHead stays invisible until the conflict delay has elapsed
            '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
            '    if [ "$(grep -c gitHead "$NPM_LOG")" -le "$GIT_HEAD_VISIBLE_AFTER" ]; then',
            "      return 1",
            "    fi",
            '    printf "%s\\n" "$GITHUB_SHA"',
            "    return 0",
            "  fi",
            "  return 1",
            "}",
            `${publishFunction} "$PACKAGE_DIR"`,
          ].join("\n"),
          {
            CONFLICT_OUTPUT,
            GITHUB_SHA: "0".repeat(40),
            GIT_HEAD_VISIBLE_AFTER: gitHeadVisibleAfter,
            NPM_LOG: npmLog,
            NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(
          output.code,
          0,
          `${publishFunction} must accept the conflicted publish once gitHead converges: ${
            decoder.decode(output.stderr)
          }`,
        );
        assertStringIncludes(
          decoder.decode(output.stdout),
          "landed despite an npm registry conflict",
        );
        const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
          .filter((line) => line.startsWith("publish"));
        assertEquals(
          publishes.length,
          1,
          `${publishFunction} must not republish an immutable name@version after the conflict delay, but issued: ${
            publishes.join(", ")
          }`,
        );
      });
    });
  }

  it("waits instead of republishing when an RC conflict version lacks gitHead", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      const delayMarker = `${stateDir}/delay-elapsed`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-llm-google" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "publish" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -gt 1 ]; then',
          '      printf "%s\\n" "npm error code E403"',
          "      return 1",
          "    fi",
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    if [ ! -f "$DELAY_MARKER" ]; then return 1; fi',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    if [ "$(grep -c gitHead "$NPM_LOG")" -lt 4 ]; then return 0; fi',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          'sleep() { : > "$DELAY_MARKER"; }',
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          CONFLICT_OUTPUT,
          DELAY_MARKER: delayMarker,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
        .filter((line) => line.startsWith("publish"));
      assertEquals(
        publishes.length,
        1,
        "an immutable name@version must not be republished while gitHead converges",
      );
    });
  });

  // The conflicting write can land while its gitHead never converges. The
  // version is immutable either way, so the helper must report the unresolved
  // identity instead of republishing over it.
  it("fails without republishing when a conflicted RC version never reports a gitHead", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-llm-google" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          // the conflicting write lands, but its gitHead stays empty forever
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 0 ]; then return 1; fi',
          '    printf "%s\\n" "$VERSION"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          "sleep() { :; }",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      const stderr = decoder.decode(output.stderr);
      assertEquals(
        output.code,
        1,
        `a published version without a readable gitHead must fail the RC publish: ${stderr}`,
      );
      assertStringIncludes(stderr, "gitHead metadata did not converge");
      const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
        .filter((line) => line.startsWith("publish"));
      assertEquals(
        publishes.length,
        1,
        `the retry must stop once the version exists, but issued: ${publishes.join(", ")}`,
      );
    });
  });

  for (
    const publishFunction of [
      "rc_publish_package_dir",
    ]
  ) {
    it(`rechecks after the final conflict in ${publishFunction}`, async () => {
      await withTempDir(async (stateDir) => {
        const packageDir = `${stateDir}/package`;
        const npmLog = `${stateDir}/npm.log`;
        await Deno.mkdir(packageDir);
        await Deno.writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({ name: "@veryfront/ext-llm-google" }),
        );
        await Deno.writeTextFile(npmLog, "");

        const output = await runBash(
          [
            "set -euo pipefail",
            'source "$SCRIPT_PATH"',
            "npm() {",
            '  printf "%s\\n" "$*" >> "$NPM_LOG"',
            '  if [ "$1" = "publish" ]; then',
            '    printf "%s\\n" "$CONFLICT_OUTPUT"',
            "    return 1",
            "  fi",
            '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
            '    if [ "$(grep -c gitHead "$NPM_LOG")" -le 2 ]; then return 1; fi',
            '    printf "%s\\n" "$GITHUB_SHA"',
            "    return 0",
            "  fi",
            '  if [ "$1" = "view" ]; then return 1; fi',
            "}",
            "sleep() { :; }",
            `${publishFunction} "$PACKAGE_DIR"`,
          ].join("\n"),
          {
            CONFLICT_OUTPUT,
            GITHUB_SHA: "0".repeat(40),
            NPM_LOG: npmLog,
            NPM_PUBLISH_CONFLICT_ATTEMPTS: "1",
            NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
            PACKAGE_DIR: packageDir,
            VERSION: "0.1.0",
          },
        );

        assertEquals(output.code, 0, decoder.decode(output.stderr));
        const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
          .filter((line) => line.startsWith("publish"));
        assertEquals(publishes.length, 1);
      });
    });
  }

  // The stable path has no final-conflict gitHead recovery: when the bounded
  // retries end in a conflict, the release fails even though the registry
  // reports a matching gitHead for the version.
  it("fails closed after the final release conflict despite a matching gitHead", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        releasePublishScript([
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
        ]),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_ATTEMPTS: "1",
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(
        output.code,
        1,
        "a stable release must not recover the final conflict through gitHead metadata",
      );
      assertStringIncludes(
        decoder.decode(output.stderr),
        "npm registry conflict persisted",
      );
      const calls = await loggedNpmCalls(npmLog);
      assertEquals(
        calls.filter((line) => line.startsWith("publish")).length,
        1,
      );
      assertEquals(
        calls.filter((line) => line.endsWith("gitHead")).length,
        0,
        "fail-closed conflict handling must not consult gitHead metadata",
      );
    });
  });

  // The retry mode is part of the publish security contract, so a typo in a
  // caller must fail the conflicted publish instead of quietly recovering.
  it("fails a conflicted publish under an unknown retry mode", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          LOG_NPM_CALL,
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    return 1",
          "  fi",
          "  return 1",
          "}",
          'publish_npm_package_with_retry bogus veryfront "$PACKAGE_DIR" || echo "EXIT=$?"',
        ].join("\n"),
        {
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertStringIncludes(decoder.decode(output.stdout), "EXIT=1");
      assertStringIncludes(
        decoder.decode(output.stderr),
        'Unknown npm publish retry mode "bogus"',
      );
      const publishes = (await loggedNpmCalls(npmLog))
        .filter((line) => line.startsWith("publish"));
      assertEquals(publishes.length, 1);
    });
  });

  // The conflicting write can also land between the pre-retry registry check
  // and the retry publish. npm rejects that publish as an ordinary
  // already-published error rather than a conflict, so the registry has to
  // settle whether the earlier conflict published this commit.
  const ALREADY_PUBLISHED_OUTPUT =
    "npm error code E403\nnpm error 403 403 Forbidden - PUT https://registry.npmjs.org/@veryfront%2fext-llm-google - You cannot publish over the previously published versions: 0.1.0.";

  it("drains diagnostic-heavy already-published classifier input under pipefail", async () => {
    for (
      const [message, expectedCode] of [
        [ALREADY_PUBLISHED_OUTPUT, 0],
        ["npm error unrelated rejection", 1],
      ] as const
    ) {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "output=\"$MESSAGE\"$'\\n'",
          'for ((index=0; index<10000; index++)); do output+=" diagnostic"; done',
          'is_npm_version_already_published "$output"',
        ].join("\n"),
        { MESSAGE: message, VERSION: "0.1.0" },
      );
      assertEquals(output.code, expectedCode, decoder.decode(output.stderr));
    }
  });

  it("accepts an already-published retry rejection in rc_publish_package_dir", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          LOG_NPM_CALL,
          '  if [ "$1" = "publish" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 1 ]; then',
          '      printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    else",
          '      printf "%s\\n" "$ALREADY_PUBLISHED_OUTPUT"',
          "    fi",
          "    return 1",
          "  fi",
          // the conflicting write stays invisible until the retry races it
          '  if [ "$1" = "view" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -le 1 ]; then return 1; fi',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
        ].join("\n"),
        {
          ALREADY_PUBLISHED_OUTPUT,
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(
        output.code,
        0,
        `the RC publish must accept a raced already-published rejection whose gitHead matches this commit: ${
          decoder.decode(output.stderr)
        }`,
      );
      const publishes = (await loggedNpmCalls(npmLog))
        .filter((line) => line.startsWith("publish"));
      assertEquals(
        publishes.length,
        2,
        `the RC publish must stop publishing once the registry shows this commit, but issued: ${
          publishes.join(", ")
        }`,
      );
    });
  });

  // The same raced rejection fails a stable release: after an earlier
  // conflict, an already-published answer means the version cannot be
  // attributed to this workflow, matching gitHead or not.
  it("fails closed when a raced release retry is rejected as already published", async () => {
    await withPackageFixture("@veryfront/ext-llm-google", async ({ packageDir, npmLog }) => {
      const output = await runBash(
        releasePublishScript([
          '  if [ "$1" = "publish" ]; then',
          '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 1 ]; then',
          '      printf "%s\\n" "$CONFLICT_OUTPUT"',
          "    else",
          '      printf "%s\\n" "$ALREADY_PUBLISHED_OUTPUT"',
          "    fi",
          "    return 1",
          "  fi",
          // the read replica lags while gitHead would report this commit
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then return 1; fi',
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
        ]),
        {
          ALREADY_PUBLISHED_OUTPUT: `${ALREADY_PUBLISHED_OUTPUT}\n${" diagnostic".repeat(10000)}`,
          CONFLICT_OUTPUT,
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      assertEquals(
        output.code,
        1,
        "a stable release must fail once npm rejects the retry over an existing version",
      );
      assertEquals(
        decoder.decode(output.stdout).includes("landed despite an npm registry conflict"),
        false,
        "an already-published stable rejection must never be recovered",
      );
      const calls = await loggedNpmCalls(npmLog);
      assertEquals(
        calls.filter((line) => line.startsWith("publish")).length,
        2,
      );
      assertEquals(
        calls.filter((line) => line.endsWith("gitHead")).length,
        0,
        "fail-closed conflict handling must not consult gitHead metadata",
      );
    });
  });

  it("fails closed when a release publish is rejected over an existing version", async () => {
    await withTempDir(async (stateDir) => {
      const packageDir = `${stateDir}/package`;
      const npmLog = `${stateDir}/npm.log`;
      await Deno.mkdir(packageDir);
      await Deno.writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({ name: "@veryfront/ext-llm-google" }),
      );
      await Deno.writeTextFile(npmLog, "");

      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          "npm() {",
          '  printf "%s\\n" "$*" >> "$NPM_LOG"',
          '  if [ "$1" = "publish" ]; then',
          '    printf "%s\\n" "npm error code E403"',
          '    printf "%s\\n" "npm error 403 You cannot publish over the previously published versions: 0.1.0"',
          "    return 1",
          "  fi",
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          'release_publish_package_dir "$PACKAGE_DIR"',
          'echo "RECOVERY_REACHED"',
        ].join("\n"),
        {
          GITHUB_SHA: "0".repeat(40),
          NPM_LOG: npmLog,
          NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
          PACKAGE_DIR: packageDir,
          VERSION: "0.1.0",
        },
      );

      const stdout = decoder.decode(output.stdout);
      assertEquals(output.code, 1, decoder.decode(output.stderr));
      assertEquals(
        stdout.includes("gitHead matches this commit; continuing."),
        false,
        "an existing release version must never be recovered, even for a matching gitHead",
      );
      assertEquals(stdout.includes("RECOVERY_REACHED"), false);
      const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
        .filter((line) => line.startsWith("publish"));
      assertEquals(publishes.length, 1);
    });
  });

  // npm's write side can reject a reused name/version while its read replica
  // still reports the package absent. The RC path has no stable-release
  // fallback, so it has to poll instead of trusting one absent lookup.
  for (const diagnostics of ["", " diagnostic".repeat(10000)]) {
    for (const registryHead of ["0".repeat(40), "1".repeat(40)]) {
      it(`checks RC gitHead after already-published rejection (${diagnostics ? "heavy" : "short"}, ${registryHead.startsWith("0") ? "matching" : "mismatched"})`, async () => {
        await withTempDir(async (stateDir) => {
          const packageDir = `${stateDir}/package`;
          const npmLog = `${stateDir}/npm.log`;
          await Deno.mkdir(packageDir);
          await Deno.writeTextFile(
            `${packageDir}/package.json`,
            JSON.stringify({ name: "@veryfront/ext-llm-google" }),
          );
          await Deno.writeTextFile(npmLog, "");

          const output = await runBash(
            [
              "set -euo pipefail",
              'source "$SCRIPT_PATH"',
              // wait_for_npm_git_head sleeps between polls; keep the test bounded
              "sleep() { :; }",
              "npm() {",
              '  printf "%s\\n" "$*" >> "$NPM_LOG"',
              '  if [ "$1" = "publish" ]; then',
              '    if [ "$(grep -c "^publish" "$NPM_LOG")" -eq 1 ]; then',
              '      printf "%s\\n" "$CONFLICT_OUTPUT"',
              "      return 1",
              "    fi",
              // the conflicted write landed, so npm refuses the immutable version
              '    printf "%s\\n" "npm error code E403"',
              '    printf "%s\\n" "npm error 403 You cannot publish over the previously published versions: 0.1.0"',
              '    printf "%s\\n" "$DIAGNOSTICS"',
              "    return 1",
              "  fi",
              // the read replica never exposes the version itself
              '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then return 1; fi',
              '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
              '    if [ "$(grep -c gitHead "$NPM_LOG")" -le 3 ]; then return 1; fi',
              '    printf "%s\\n" "$REGISTRY_HEAD"',
              "    return 0",
              "  fi",
              "  return 1",
              "}",
              'rc_publish_package_dir "$PACKAGE_DIR"',
            ].join("\n"),
            {
              CONFLICT_OUTPUT,
              DIAGNOSTICS: diagnostics,
              REGISTRY_HEAD: registryHead,
              GITHUB_SHA: "0".repeat(40),
              NPM_LOG: npmLog,
              NPM_PUBLISH_CONFLICT_ATTEMPTS: "3",
              NPM_PUBLISH_CONFLICT_DELAY_SECONDS: "0",
              PACKAGE_DIR: packageDir,
              VERSION: "0.1.0",
            },
          );

          assertEquals(
            output.code,
            registryHead.startsWith("0") ? 0 : 1,
            `an already-published rejection after a handled conflict must poll for gitHead instead of failing the RC publish: ${
              decoder.decode(output.stderr)
            }`,
          );
          if (registryHead.startsWith("0")) {
            assertStringIncludes(
              decoder.decode(output.stdout),
              "landed despite an npm registry conflict",
            );
          } else {
            assertStringIncludes(decoder.decode(output.stderr), `instead of ${"0".repeat(40)}`);
          }
          const calls = await loggedNpmCalls(npmLog);
          assertEquals(calls.filter((line) => line.includes(" gitHead")).length, 4);
          const publishes = (await Deno.readTextFile(npmLog)).trim().split("\n")
            .filter((line) => line.startsWith("publish"));
          assertEquals(
            publishes.length,
            2,
            `the RC publish must stop republishing once npm reports the version already exists, but issued: ${
              publishes.join(", ")
            }`,
          );
        });
      });
    }
  }
});

describe("RC publication deadline", () => {
  for (const status of [0, 124, 137, 42]) {
    it(`preserves publish status ${status} and diagnoses deadline failures`, async () => {
      const workflow = parse(
        await Deno.readTextFile(
          new URL("../../.github/workflows/cicd.yml", import.meta.url),
        ),
      ) as {
        jobs: { prerelease: { steps: { name?: string; run?: string }[] } };
      };
      const publish = workflow.jobs.prerelease.steps.find((step) =>
        step.name === "Publish tested RC npm artifact"
      )!;
      await withTempDir(async (stateDir) => {
        const output = await runBash(
          [
            "set -euo pipefail",
            "deno() { :; }",
            'timeout() { return "$PUBLISH_STATUS"; }',
            publish.run!,
          ].join("\n"),
          {
            PUBLISH_STATUS: String(status),
            GITHUB_STEP_SUMMARY: `${stateDir}/summary`,
          },
        );
        assertEquals(output.code, status, decoder.decode(output.stderr));
        const stderr = decoder.decode(output.stderr);
        if (status === 124 || status === 137) {
          assertStringIncludes(
            stderr,
            "RC npm publication exceeded its eight-minute deadline",
          );
        } else {
          assertEquals(stderr, "");
        }
      });
    });
  }

  it("does not fail a successful publish while metadata is still propagating", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        "verify_npm_compatibility_artifact() { :; }",
        "package_dirs() { echo npm; }",
        "canonical_tarball_for_package_dir() { echo package.tgz; }",
        "jq() { echo veryfront; }",
        "rc_tag_for_package() { echo rc; }",
        "rc_publish_package_dir() { :; }",
        "wait_for_npm_git_head() { PUBLISHED_GIT_HEAD=''; return 1; }",
        "run_rc_publish",
      ].join("\n"),
      {
        VERSION: "0.1.0-rc.1",
        GITHUB_SHA: "expected-head",
        NPM_PACK_DIR: "artifact",
      },
    );
    assertEquals(output.code, 0, decoder.decode(output.stderr));
    assertEquals(decoder.decode(output.stderr), "");
  });
});

describe("RC metadata verification order", () => {
  for (
    const [scenario, body, status, tag, transportStatus] of [
      [
        "wrong package",
        { name: "other", version: "0.1.0-rc.1", gitHead: "expected-head" },
        "200",
        "0.1.0-rc.1",
        "0",
      ],
      [
        "wrong version",
        { name: "veryfront", version: "0.1.0-rc.2", gitHead: "expected-head" },
        "200",
        "0.1.0-rc.1",
        "0",
      ],
      [
        "wrong hash",
        { name: "veryfront", version: "0.1.0-rc.1", gitHead: "other-head" },
        "200",
        "0.1.0-rc.1",
        "0",
      ],
      [
        "invalid hash",
        { name: "veryfront", version: "0.1.0-rc.1", gitHead: 123 },
        "200",
        "0.1.0-rc.1",
        "0",
      ],
      [
        "missing hash",
        { name: "veryfront", version: "0.1.0-rc.1" },
        "200",
        "0.1.0-rc.1",
        "0",
      ],
      [
        "old tag",
        { name: "veryfront", version: "0.1.0-rc.1", gitHead: "expected-head" },
        "200",
        "0.1.0-rc.0",
        "0",
      ],
      ["server error", {}, "503", "0.1.0-rc.1", "0"],
      ["transport error", {}, "000", "0.1.0-rc.1", "7"],
      ["malformed JSON", "not-json", "200", "0.1.0-rc.1", "0"],
    ] as const
  ) {
    it(`refuses exact-version RC metadata with ${scenario}`, async () => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'npm() { if [ "$1" = config ]; then echo https://registry.npmjs.org/; else echo "rc: $RC_TAG"; fi; }',
          'curl() { printf \'%s\\n\' "$BODY" "$HTTP_STATUS"; return "$TRANSPORT_STATUS"; }',
          "wait_for_npm_git_head veryfront rc",
        ].join("\n"),
        {
          VERSION: "0.1.0-rc.1",
          GITHUB_SHA: "expected-head",
          BODY: typeof body === "string" ? body : JSON.stringify(body),
          HTTP_STATUS: status,
          RC_TAG: tag,
          TRANSPORT_STATUS: transportStatus,
          NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "0",
        },
      );
      assertEquals(output.code === 0, false);
    });
  }

  it("waits for an exact RC version that is not yet visible", async () => {
    await withTempDir(async (stateDir) => {
      const output = await runBash(
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'npm() { if [ "$1" = config ]; then echo https://registry.npmjs.org/; else echo "rc: $VERSION"; fi; }',
          'curl() { if [ ! -f "$READ_MARKER" ]; then : > "$READ_MARKER"; printf \'%s\\n\' "{}" 404; else printf \'%s\\n\' \'{"name":"veryfront","version":"0.1.0-rc.1","gitHead":"expected-head"}\' 200; fi; }',
          "wait_for_npm_git_head veryfront rc",
          'test "$PUBLISHED_GIT_HEAD" = "$GITHUB_SHA"',
        ].join("\n"),
        {
          VERSION: "0.1.0-rc.1",
          GITHUB_SHA: "expected-head",
          READ_MARKER: `${stateDir}/read`,
          NPM_GIT_HEAD_WAIT_ATTEMPTS: "2",
          NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "0",
        },
      );
      assertEquals(output.code, 0, decoder.decode(output.stderr));
    });
  });

  it("verifies the exact RC version when a cached package document omits it", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        'npm() { case "$1" in view) return 0 ;; config) echo https://registry.npmjs.org/ ;; dist-tag) echo "rc: $VERSION" ;; *) return 91 ;; esac; }',
        'curl() { case "$*" in *https://registry.npmjs.org/%40veryfront%2Fexample/0.1.0-rc.1*) printf \'%s\\n\' \'{"name":"@veryfront/example","version":"0.1.0-rc.1","gitHead":"expected-head"}\' 200 ;; *) return 92 ;; esac; }',
        "lookup_npm_git_head @veryfront/example rc",
        'test "$PUBLISHED_GIT_HEAD" = "$GITHUB_SHA"',
      ].join("\n"),
      { VERSION: "0.1.0-rc.1", GITHUB_SHA: "expected-head" },
    );
    assertEquals(output.code, 0, decoder.decode(output.stderr));
  });

  it("publishes the batch without waiting for registry propagation", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        "verify_npm_compatibility_artifact() { :; }",
        "package_dirs() { printf '%s\\n' extension history npm; }",
        "canonical_tarball_for_package_dir() { echo package.tgz; }",
        'jq() { echo "$PACKAGE_DIR"; }',
        'rc_tag_for_package() { if [ "$1" = history ]; then echo rc-history; else echo rc; fi; }',
        'rc_publish_package_dir() { echo "publish:$1:$3"; }',
        'wait_for_npm_git_head() { echo "verify:$1:$2"; }',
        "run_rc_publish",
      ].join("\n"),
      {
        VERSION: "0.1.0-rc.1",
        GITHUB_SHA: "expected-head",
        NPM_PACK_DIR: "artifact",
      },
    );
    assertEquals(output.code, 0, decoder.decode(output.stderr));
    assertEquals(decoder.decode(output.stdout).trim().split("\n"), [
      "publish:extension:rc",
      "publish:history:rc-history",
      "publish:npm:rc",
    ]);
  });
  it("refuses a maintenance batch before any publish if any package would move rc", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        "verify_npm_compatibility_artifact() { :; }",
        "package_dirs() { printf '%s\\n' extension npm; }",
        "canonical_tarball_for_package_dir() { echo package.tgz; }",
        'jq() { echo "$PACKAGE_DIR"; }',
        'rc_tag_for_package() { if [ "$1" = extension ]; then echo rc-history; else echo rc; fi; }',
        'npm() { printf "%s\n" "npm error code E404" >&2; return 1; }',
        'rc_publish_package_dir() { echo "UNSAFE-PUBLISH"; }',
        "run_rc_publish",
      ].join("\n"),
      {
        VERSION: "0.1.0-rc.1",
        GITHUB_SHA: "expected-head",
        NPM_PACK_DIR: "artifact",
        NPM_MAINTENANCE_RELEASE: "true",
      },
    );
    assertEquals(output.code, 1);
    assertEquals(
      decoder.decode(output.stdout).includes("UNSAFE-PUBLISH"),
      false,
    );
  });

  it("refuses a maintenance batch before any publish if a later immutable version belongs to another commit", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        "verify_npm_compatibility_artifact() { :; }",
        "package_dirs() { printf '%s\\n' extension npm; }",
        "canonical_tarball_for_package_dir() { echo package.tgz; }",
        'jq() { echo "$PACKAGE_DIR"; }',
        "rc_tag_for_package() { echo rc-history; }",
        'npm() { case "$*" in "view npm@0.1.0-rc.1 version") echo 0.1.0-rc.1 ;; "view npm@0.1.0-rc.1 gitHead") echo other-head ;; "view "*" version") printf "%s\n" "npm error code E404" >&2; return 1 ;; *) return 90 ;; esac; }',
        'rc_publish_package_dir() { echo "UNSAFE-PUBLISH"; }',
        "run_rc_publish",
      ].join("\n"),
      {
        VERSION: "0.1.0-rc.1",
        GITHUB_SHA: "expected-head",
        NPM_PACK_DIR: "artifact",
        NPM_MAINTENANCE_RELEASE: "true",
      },
    );
    assertEquals(output.code, 1);
    assertStringIncludes(
      decoder.decode(output.stderr),
      "npm@0.1.0-rc.1 already exists, but its gitHead does not match this commit.",
    );
    assertEquals(
      decoder.decode(output.stdout).includes("UNSAFE-PUBLISH"),
      false,
    );
  });

  it("refuses a maintenance batch before any publish if an immutable version lookup fails", async () => {
    const output = await runBash(
      [
        "set -euo pipefail",
        'source "$SCRIPT_PATH"',
        "verify_npm_compatibility_artifact() { :; }",
        "package_dirs() { printf '%s\n' extension npm; }",
        "canonical_tarball_for_package_dir() { echo package.tgz; }",
        'jq() { echo "$PACKAGE_DIR"; }',
        "rc_tag_for_package() { echo rc-history; }",
        'npm() { case "$*" in "view extension@0.1.0-rc.1 version") printf "%s\n" "npm error code E503" >&2; printf "%s\n" "npm error 503 Service Unavailable" >&2; return 1 ;; "view npm@0.1.0-rc.1 version") printf "%s\n" "npm error code E404" >&2; return 1 ;; *) return 90 ;; esac; }',
        'rc_publish_package_dir() { echo "UNSAFE-PUBLISH"; }',
        "run_rc_publish",
      ].join("\n"),
      {
        VERSION: "0.1.0-rc.1",
        GITHUB_SHA: "expected-head",
        NPM_PACK_DIR: "artifact",
        NPM_MAINTENANCE_RELEASE: "true",
      },
    );
    assertEquals(output.code, 1);
    assertStringIncludes(
      decoder.decode(output.stderr),
      "npm registry version lookup failed for extension@0.1.0-rc.1",
    );
    assertEquals(
      decoder.decode(output.stdout).includes("UNSAFE-PUBLISH"),
      false,
    );
  });

  it("keeps the maintenance publish lookup fail-closed after batch preflight", async () => {
    const output = await runBash([
      "set -euo pipefail",
      'source "$SCRIPT_PATH"',
      "jq() { echo veryfront; }",
      'npm() { echo "npm error code ETIMEDOUT" >&2; return 1; }',
      'publish_npm_package_with_retry() { echo "UNSAFE-PUBLISH"; }',
      "rc_publish_package_dir package",
    ].join("\n"), { VERSION: "0.1.0-rc.1", GITHUB_SHA: "expected-head", NPM_MAINTENANCE_RELEASE: "true" });
    assertEquals(output.code, 1);
    assertEquals(decoder.decode(output.stdout).includes("UNSAFE-PUBLISH"), false);
    assertStringIncludes(decoder.decode(output.stderr), "npm registry version lookup failed");
  });

  it("keeps maintenance dispatch disabled while retaining the release gates", async () => {
    const workflow = parse(
      await Deno.readTextFile(
        new URL("../../.github/workflows/cicd.yml", import.meta.url),
      ),
    ) as {
      jobs: Record<
        string,
        {
          if?: string;
          steps?: Array<{
            name?: string;
            if?: string;
            env?: Record<string, string>;
            run?: string;
          }>;
        }
      >;
    };
    for (
      const name of ["quality-gate-release", "version-check", "build-binaries"]
    ) {
      assertStringIncludes(workflow.jobs[name].if ?? "", "workflow_dispatch");
      assertStringIncludes(
        workflow.jobs[name].if ?? "",
        "maintenance_release_number",
      );
    }
    for (const step of workflow.jobs["quality-gate-registry"].steps ?? []) {
      if (step.name?.startsWith("Trigger ")) {
        assertStringIncludes(
          step.if ?? "",
          "!(github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '')",
        );
      }
    }
    const githubRelease = workflow.jobs["publish-public-release"].steps?.find(
      (step) => step.name === "Create GitHub releases",
    );
    assertEquals(
      githubRelease?.env?.MAINTENANCE_RELEASE,
      "${{ github.event_name == 'workflow_dispatch' && inputs.maintenance_release_number != '' }}",
    );
    assertStringIncludes(
      githubRelease?.run ?? "",
      'install_target="veryfront@${VERSION}"',
    );
    assertStringIncludes(
      githubRelease?.run ?? "",
      'install_target="veryfront@rc"',
    );
  });
});
