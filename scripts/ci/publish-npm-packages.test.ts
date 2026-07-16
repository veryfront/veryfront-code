import { assertEquals, assertStringIncludes } from "#std/assert";

const scriptPath = `${Deno.cwd()}/scripts/ci/publish-npm-packages.sh`;
const decoder = new TextDecoder();

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

Deno.test("npm gitHead verification tolerates metadata appearing after 120 seconds", async () => {
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

Deno.test("npm gitHead verification fails fast on a wrong non-empty hash", async () => {
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

Deno.test("npm release rerun skips a package already published for the commit", async () => {
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

    assertEquals(output.code, 0, decoder.decode(output.stderr));
    const calls = (await Deno.readTextFile(npmLog)).trim().split("\n");
    assertEquals(calls, [
      "view @veryfront/ext-auth-jwt@0.1.1069 gitHead",
      "view @veryfront/ext-auth-jwt@0.1.1069 gitHead",
    ]);
    assertStringIncludes(
      decoder.decode(output.stdout),
      "already published for this commit; skipping npm publish",
    );
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});
