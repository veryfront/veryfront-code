import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { fileURLToPath } from "node:url";

const root = new URL("../../../../", import.meta.url);
const fixture = new URL("fixtures/runs-cli.ts", import.meta.url);

async function cli(scenario: string, config?: unknown) {
  const dir = await Deno.makeTempDir({ prefix: "vf-runs-cli-" });
  try {
    await Deno.writeTextFile(`${dir}/credential`, "scoped-test-token\n");
    await Deno.writeTextFile(
      `${dir}/veryfront.config.ts`,
      'throw new Error("Project modules must not execute");',
    );
    if (config) await Deno.writeTextFile(`${dir}/veryfront.json`, JSON.stringify(config));
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--frozen", "--allow-all", fixture.href, dir, scenario],
      cwd: fileURLToPath(root),
      env: {
        VERYFRONT_API_URL: config ? "" : "https://api.example.test",
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_API_TOKEN: "",
        VF_DISABLE_LRU_INTERVAL: "1",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe("project runs CLI output and host credentials", () => {
  it("dispatches through the existing project handler and emits JSON with a file credential and no login", async () => {
    const result = await cli("success");
    assertEquals(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.success, true);
    assertEquals(envelope.command, "project runs");
    assertEquals(envelope.data.id, "11111111-1111-4111-8111-111111111111");
    assert(!result.stdout.includes("scoped-test-token"));
  });

  it("selects API-key auth on the canonical host transport", async () => {
    const result = await cli("api-key");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).success, true);
  });

  it("emits one JSON envelope per stream frame without human output", async () => {
    const result = await cli("stream");
    assertEquals(result.code, 0, result.stderr);
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert(lines.length > 0);
    assert(lines.every((line) => line.success === true && line.command === "project runs"));
    assertEquals(lines[0].data.id, "42");
  });

  it("preserves Problem codes and maps validation and authorization failures to actual process exits", async () => {
    for (
      const [scenario, exitCode, problemCode] of [["validation", 2, "INVALID_REQUEST"], [
        "forbidden",
        1,
        "FORBIDDEN",
      ]] as const
    ) {
      const result = await cli(scenario);
      assertEquals(result.code, exitCode, result.stderr);
      const envelope = JSON.parse(result.stdout);
      assertEquals(envelope.success, false);
      assertEquals(envelope.error.code, problemCode);
      assertEquals(envelope.error.slug, exitCode === 2 ? "invalid-arguments" : "command-failed");
      assert(!result.stdout.includes("scoped-test-token"));
    }
  });

  it("refuses to send a file credential to an endpoint supplied by the repository", async () => {
    const result = await cli("success", {
      apiUrl: "https://untrusted.example.test",
      apiToken: "repository-token",
    });
    assertEquals(result.code, 1);
    assert(result.stderr.includes("Set the API endpoint explicitly"));
    assert(!result.stderr.includes("scoped-test-token"));
  });
});
