import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

describe("npm package publishing", () => {
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
      assertEquals(calls.filter((line) => line.endsWith("gitHead")).length, 4);
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
  it("polls for metadata when a raced retry is rejected as already published", async () => {
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
          "    return 1",
          "  fi",
          // the read replica never exposes the version itself
          '  if [ "$1" = "view" ] && [ "$3" = "version" ]; then return 1; fi',
          '  if [ "$1" = "view" ] && [ "$3" = "gitHead" ]; then',
          '    if [ "$(grep -c gitHead "$NPM_LOG")" -le 3 ]; then return 1; fi',
          '    printf "%s\\n" "$GITHUB_SHA"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          'rc_publish_package_dir "$PACKAGE_DIR"',
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

      assertEquals(
        output.code,
        0,
        `an already-published rejection after a handled conflict must poll for gitHead instead of failing the RC publish: ${
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
        2,
        `the RC publish must stop republishing once npm reports the version already exists, but issued: ${
          publishes.join(", ")
        }`,
      );
    });
  });
});
