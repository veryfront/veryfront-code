import "#veryfront/schemas/_test-setup.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";

/**
 * Exit codes are the machine-readable contract for the auth commands: CI steps,
 * shell scripts, and agents gate on them. These tests drive the real CLI entry
 * point in a subprocess so the assertion is on the process exit code itself.
 */
describe("cli/auth exit codes", { sanitizeOps: false, sanitizeResources: false }, () => {
  const cliPath = fromFileUrl(new URL("../main.ts", import.meta.url));
  const configPath = fromFileUrl(new URL("../../deno.json", import.meta.url));

  /**
   * Runs the CLI with no usable credential: an empty `VERYFRONT_API_TOKEN` and a
   * throwaway `XDG_CONFIG_HOME` so the developer's stored token is never read.
   * The cwd is a temp directory so a repository `.env` cannot supply a token.
   */
  async function runUnauthenticated(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const tempDir = await makeTempDir({ prefix: "cli-auth-exit-code-" });
    try {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--config", configPath, cliPath, ...args],
        cwd: tempDir,
        env: {
          VERYFRONT_API_TOKEN: "",
          XDG_CONFIG_HOME: `${tempDir}/config`,
          VERYFRONT_NO_UPDATE_CHECK: "1",
          NO_COLOR: "1",
          CI: "1",
        },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const decoder = new TextDecoder();

      return {
        code: result.code,
        stdout: decoder.decode(result.stdout),
        stderr: decoder.decode(result.stderr),
      };
    } finally {
      await remove(tempDir, { recursive: true });
    }
  }

  it("whoami exits non-zero when no credential is available", async () => {
    const result = await runUnauthenticated(["whoami"]);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stdout, "Not logged in");
    assertStringIncludes(result.stdout, "veryfront login");
  });

  it("whoami --json exits non-zero and still reports authenticated: false", async () => {
    const result = await runUnauthenticated(["whoami", "--json"]);

    assertEquals(result.code, 1);
    assertEquals(JSON.parse(result.stdout).data, { authenticated: false });
  });

  it("login exits non-zero when it cannot obtain a credential", async () => {
    const result = await runUnauthenticated(["login"]);

    assertEquals(result.code, 1);
  });

  it("whoami still exits zero when a credential validates", async () => {
    const server = Deno.serve(
      { port: 0, onListen: () => {} },
      () => Response.json({ id: "user-123", email: "cli@example.test" }),
    );
    const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const tempDir = await makeTempDir({ prefix: "cli-auth-exit-code-ok-" });

    try {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--config", configPath, cliPath, "whoami"],
        cwd: tempDir,
        env: {
          VERYFRONT_API_TOKEN: "user-session-token",
          VERYFRONT_API_BASE_URL: baseUrl,
          XDG_CONFIG_HOME: `${tempDir}/config`,
          VERYFRONT_NO_UPDATE_CHECK: "1",
          NO_COLOR: "1",
          CI: "1",
        },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(result.code, 0);
      assertStringIncludes(new TextDecoder().decode(result.stdout), "cli@example.test");
    } finally {
      await server.shutdown();
      await remove(tempDir, { recursive: true });
    }
  });
});
