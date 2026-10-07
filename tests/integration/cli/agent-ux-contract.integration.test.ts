import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const repoRoot = fromFileUrl(new URL("../../..", import.meta.url));
const cliPath = fromFileUrl(new URL("../../../cli/main.ts", import.meta.url));
const configPath = fromFileUrl(new URL("../../../deno.json", import.meta.url));

async function runCli(args: string[]): Promise<CliResult> {
  const tempDir = await makeTempDir({ prefix: "cli-agent-ux-contract-" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--frozen", "--allow-all", "--config", configPath, cliPath, ...args],
      cwd: repoRoot,
      env: {
        VERYFRONT_API_TOKEN: "",
        XDG_CONFIG_HOME: `${tempDir}/config`,
        VERYFRONT_NO_UPDATE_CHECK: "1",
        VF_DISABLE_LRU_INTERVAL: "1",
        NO_COLOR: "1",
        CI: "1",
      },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).output();
    const decoder = new TextDecoder();
    return {
      code: result.code,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  } finally {
    clearTimeout(timeout);
    await remove(tempDir, { recursive: true });
  }
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

describe("CLI agent UX contract", () => {
  it("routes an unknown pre-command option to the intended command JSON error", async () => {
    const result = await runCli(["--definitely-bad", "schema", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "schema");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Unknown option --definitely-bad");
  });

  it("routes an unknown pre-command short option to the intended command JSON error", async () => {
    const result = await runCli(["-x", "schema", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "schema");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Unknown option -x");
  });

  it("routes command-specific pre-command value options to the intended command", async () => {
    const result = await runCli(["--config", "schema", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "schema");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Unknown option --config");
  });

  it("emits JSON for unknown schema command usage errors", async () => {
    const result = await runCli(["schema", "no-such-command", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "schema");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Unknown command: no-such-command");
  });

  it("rejects unknown schema categories in JSON mode", async () => {
    const result = await runCli(["schema", "--category", "not-real", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "schema");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Invalid schema arguments");
  });

  it("emits structured JSON for main help", async () => {
    const result = await runCli(["--help", "--json"]);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      data: { usage: string; commands: Array<{ name: string }> };
    };
    assertEquals(payload.success, true);
    assertEquals(payload.command, "help");
    assertEquals(payload.data.usage, "veryfront <command> [options]");
    assertEquals(payload.data.commands.some((command) => command.name === "init"), true);
  });
  it("emits structured JSON for bare help command help-flag form", async () => {
    const result = await runCli(["help", "--help", "--json"]);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      data: { usage: string; commands: Array<{ name: string }> };
    };
    assertEquals(payload.success, true);
    assertEquals(payload.command, "help");
    assertEquals(payload.data.usage, "veryfront <command> [options]");
    assertEquals(payload.data.commands.some((command) => command.name === "init"), true);
  });

  it("emits structured JSON for command help", async () => {
    const result = await runCli(["init", "--help", "--json"]);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      data: { topic: string; help: { name: string; usage: string } };
    };
    assertEquals(payload.success, true);
    assertEquals(payload.command, "help");
    assertEquals(payload.data.topic, "init");
    assertEquals(payload.data.help.name, "init");
    assertStringIncludes(payload.data.help.usage, "veryfront init");
  });
  it("emits structured JSON for help command help-flag form", async () => {
    const result = await runCli(["help", "init", "--help", "--json"]);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      data: { topic: string; help: { name: string; usage: string } };
    };
    assertEquals(payload.success, true);
    assertEquals(payload.command, "help");
    assertEquals(payload.data.topic, "init");
    assertEquals(payload.data.help.name, "init");
    assertStringIncludes(payload.data.help.usage, "veryfront init");
  });

  it("emits structured JSON for aliased command help", async () => {
    const result = await runCli(["projects", "--help", "--json"]);

    assertEquals(result.code, 0);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      data: { topic: string; help: { name: string; aliases: string[] } };
    };
    assertEquals(payload.success, true);
    assertEquals(payload.command, "help");
    assertEquals(payload.data.topic, "projects");
    assertEquals(payload.data.help.name, "project");
    assertEquals(payload.data.help.aliases.includes("projects"), true);
  });
  it("rejects inherited object names in structured command help", async () => {
    const result = await runCli(["help", "toString", "--json"]);

    assertEquals(result.code, 2);
    assertEquals(result.stderr, "");
    const payload = parseJson(result.stdout) as {
      success: boolean;
      command: string;
      error: { slug: string; message: string };
    };
    assertEquals(payload.success, false);
    assertEquals(payload.command, "help");
    assertEquals(payload.error.slug, "invalid-arguments");
    assertStringIncludes(payload.error.message, "Unknown command: toString");
  });

  it("keeps whoami unauthenticated non-zero with a failure envelope", async () => {
    const result = await runCli(["whoami", "--json"]);

    assertEquals(result.code, 1);
    assertEquals(result.stderr, "");
    assertEquals(parseJson(result.stdout), {
      success: false,
      command: "whoami",
      error: {
        code: "AUTHENTICATION_ERROR",
        slug: "authentication-required",
        registrySlug: "authentication-required",
        message: "Not logged in. Run 'veryfront login' to authenticate.",
        context: { authenticated: false },
      },
    });
  });
});
