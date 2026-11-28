/**
 * A linked project whose stored login expired: `veryfront task` must stop
 * before the task runs, with the authentication-required JSON envelope and
 * exit code 1, instead of failing each model call with a bare gateway 401.
 * Drives the real CLI entry point in a subprocess against a local API stub.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { fileURLToPath } from "node:url";

const root = new URL("../../../../", import.meta.url);
const STORED_LOGIN = "<TOKEN>-stored-login";

interface ApiRequest {
  path: string;
  authorization: string | null;
}

/** Environment for the CLI: no inherited Veryfront or provider credentials. */
function cliEnv(apiUrl: string, configHome: string): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([key]) =>
      !key.startsWith("VERYFRONT_") && !key.startsWith("TENANT_") &&
      !key.endsWith("_API_KEY") && !key.endsWith("_BASE_URL") && !key.startsWith("OTEL_")
    ),
  );
  return {
    ...inherited,
    XDG_CONFIG_HOME: configHome,
    VERYFRONT_API_URL: apiUrl,
    // A provider key is present, yet a linked project must not fall back to it.
    OPENAI_API_KEY: "<API_KEY>",
    VERYFRONT_NO_UPDATE_CHECK: "1",
    VF_DISABLE_LRU_INTERVAL: "1",
    NO_COLOR: "1",
    CI: "1",
  };
}

async function withLinkedProject(
  loginStatus: number,
  fn: (run: (args: string[]) => Promise<Deno.CommandOutput>, context: {
    projectDir: string;
    requests: ApiRequest[];
  }) => Promise<void>,
): Promise<void> {
  const requests: ApiRequest[] = [];
  const api = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
    requests.push({
      path: new URL(request.url).pathname,
      authorization: request.headers.get("authorization"),
    });
    return loginStatus === 200
      ? Response.json({ id: "user-1", email: "dev@example.test" })
      : new Response(null, { status: loginStatus });
  });
  const projectDir = await makeTempDir({ prefix: "vf-linked-expired-login-" });
  const configHome = await makeTempDir({ prefix: "vf-linked-expired-login-config-" });
  try {
    await Deno.mkdir(join(configHome, "veryfront"), { recursive: true });
    await Deno.writeTextFile(join(configHome, "veryfront", "token"), `${STORED_LOGIN}\n`);
    await Deno.writeTextFile(
      join(projectDir, "veryfront.json"),
      JSON.stringify({ projectSlug: "linked-project" }),
    );
    await Deno.mkdir(join(projectDir, "tasks"));
    await Deno.writeTextFile(
      join(projectDir, "tasks", "ping.ts"),
      `export default {
  name: "Ping",
  async run() {
    await Deno.writeTextFile(${JSON.stringify(join(projectDir, "ran.txt"))}, "ran");
    return { ok: true };
  },
};
`,
    );
    const apiUrl = `http://127.0.0.1:${api.addr.port}`;
    const run = (args: string[]) =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${fileURLToPath(new URL("deno.json", root))}`,
          "--allow-all",
          fileURLToPath(new URL("cli/main.ts", root)),
          ...args,
        ],
        cwd: projectDir,
        clearEnv: true,
        env: cliEnv(apiUrl, configHome),
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(120_000),
      }).output();
    await fn(run, { projectDir, requests });
  } finally {
    await api.shutdown();
    await Deno.remove(projectDir, { recursive: true });
    await Deno.remove(configHome, { recursive: true });
  }
}

async function taskRan(projectDir: string): Promise<boolean> {
  return await Deno.stat(join(projectDir, "ran.txt")).then(() => true, () => false);
}

describe("veryfront task in a linked project with an expired stored login", () => {
  it("stops before the task runs with the authentication-required envelope and exit 1", async () => {
    await withLinkedProject(401, async (run, { projectDir, requests }) => {
      const output = await run(["task", "ping", "--json"]);
      const stdout = new TextDecoder().decode(output.stdout);

      assertEquals(output.code, 1, new TextDecoder().decode(output.stderr));
      const envelope = JSON.parse(stdout);
      assertEquals(envelope.success, false);
      assertEquals(envelope.command, "task");
      // Router failures keep the stable `command-failed` slug; the registry
      // classification goes in `registrySlug`.
      assertEquals(envelope.error.code, "RUNTIME_ERROR");
      assertEquals(envelope.error.slug, "command-failed");
      assertEquals(envelope.error.registrySlug, "authentication-required");
      assertEquals(
        envelope.error.message,
        "Your Veryfront login expired. Run `veryfront login`.",
      );
      // The stored login never appears in the output.
      assertEquals(stdout.includes(STORED_LOGIN), false);
      assertEquals(await taskRan(projectDir), false);
      // The one API request is the login check, sent to the operator API.
      assertEquals(requests, [{ path: "/me", authorization: `Bearer ${STORED_LOGIN}` }]);
    });
  });

  it("says how to log in again in human output", async () => {
    await withLinkedProject(401, async (run, { projectDir }) => {
      const output = await run(["task", "ping"]);
      const stderr = new TextDecoder().decode(output.stderr);

      assertEquals(output.code, 1);
      assertEquals(stderr.includes("[authentication-required]"), true, stderr);
      assertEquals(
        stderr.includes("Your Veryfront login expired. Run `veryfront login`."),
        true,
        stderr,
      );
      assertEquals(stderr.includes(STORED_LOGIN), false);
      assertEquals(await taskRan(projectDir), false);
    });
  });

  it("runs the task when the API accepts the stored login", async () => {
    await withLinkedProject(200, async (run, { projectDir, requests }) => {
      const output = await run(["task", "ping"]);

      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
      assertEquals(await taskRan(projectDir), true);
      assertEquals(requests[0], { path: "/me", authorization: `Bearer ${STORED_LOGIN}` });
    });
  });
});
