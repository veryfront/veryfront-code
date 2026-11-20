/**
 * End to end: `veryfront login` in a folder whose `.env` chooses the API.
 *
 * Runs the real CLI entry in a child process with network access denied, so a
 * pass also proves the refusal happens before any request leaves the machine.
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../../../", import.meta.url);

let projectDir: string;
let configHome: string;

/** Run `veryfront login --no-input` in the project with only `shell` exported. */
async function runLogin(
  shell: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const inherited: Record<string, string> = {};
  for (const key of ["HOME", "PATH", "DENO_DIR", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value !== undefined) inherited[key] = value;
  }
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--config=${fileURLToPath(new URL("deno.json", ROOT))}`,
      "--frozen",
      "--allow-all",
      "--deny-net",
      fileURLToPath(new URL("cli/main.ts", ROOT)),
      "login",
      "--no-input",
    ],
    cwd: projectDir,
    clearEnv: true,
    env: {
      ...inherited,
      XDG_CONFIG_HOME: configHome,
      NO_COLOR: "1",
      VERYFRONT_NO_UPDATE_CHECK: "1",
      VF_DISABLE_LRU_INTERVAL: "1",
      ...shell,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

describe("veryfront login with a project-set API URL", () => {
  beforeEach(async () => {
    projectDir = await makeTempDir({ prefix: "vf-login-project-api-url-" });
    configHome = await makeTempDir({ prefix: "vf-login-config-home-" });
  });

  afterEach(async () => {
    await Deno.remove(projectDir, { recursive: true });
    await Deno.remove(configHome, { recursive: true });
  });

  it("stops with project-api-url, production first, before any request", async () => {
    await Deno.writeTextFile(
      join(projectDir, ".env"),
      "VERYFRONT_API_URL=https://api.veryfront.org\n",
    );

    const { code, stdout, stderr } = await runLogin();
    const output = stdout + stderr;

    assertEquals(code, 1, output);
    assertStringIncludes(output, "[project-api-url] This project uses a different Veryfront API");
    assertStringIncludes(
      output,
      "Docs: https://veryfront.com/docs/code/guides/errors#project-api-url",
    );
    assertEquals(output.includes("unknown-error"), false, output);
    const production = output.indexOf("To use production, remove VERYFRONT_API_URL from .env.");
    const override = output.indexOf(
      "run: VERYFRONT_API_URL=https://api.veryfront.org npx veryfront login",
    );
    assert(production >= 0 && override > production, output);
    assertEquals(output.includes(projectDir), false, "the refusal must not print local paths");
    assertEquals(output.includes("NotCapable"), false, "login must not attempt a request");
  });

  it("does not echo a host that isn't Veryfront's", async () => {
    await Deno.writeTextFile(
      join(projectDir, ".env"),
      "VERYFRONT_API_URL=https://attacker.example/?token=s3cret-marker\n",
    );

    const { code, stdout, stderr } = await runLogin();
    const output = stdout + stderr;

    assertEquals(code, 1, output);
    assertStringIncludes(output, "[project-api-url]");
    assertStringIncludes(output, "run: VERYFRONT_API_URL=<its URL> npx veryfront login");
    assertEquals(output.includes("attacker"), false, output);
    assertEquals(output.includes("s3cret-marker"), false, output);
  });

  it("reaches sign-in once the shell sets the printed override", async () => {
    await Deno.writeTextFile(
      join(projectDir, ".env"),
      "VERYFRONT_API_URL=https://api.veryfront.org\n",
    );

    const { stdout, stderr } = await runLogin({ VERYFRONT_API_URL: "https://api.veryfront.org" });
    const output = stdout + stderr;

    assertEquals(output.includes("project-api-url"), false, output);
    assertStringIncludes(output, "Not logged in.");
  });

  it("reaches sign-in once the setting is removed from .env", async () => {
    await Deno.writeTextFile(join(projectDir, ".env"), "OTHER_SETTING=1\n");

    const { stdout, stderr } = await runLogin();
    const output = stdout + stderr;

    assertEquals(output.includes("project-api-url"), false, output);
    assertStringIncludes(output, "Not logged in.");
  });
});
