/**
 * Watch the unit lane's network permission actually block something.
 *
 * The unit suite runs with `--allow-net` limited to loopback instead of a
 * `--deny-net` list of provider hosts. That inversion only pays off if an
 * arbitrary destination is refused, so this runs a throwaway test file under
 * the very flags `deno.json` ships and asserts the runtime stops it before a
 * connection is opened.
 *
 * The destination is deliberately a host the old deny-list never named. Under
 * the deny-list it was reachable; that is the whole point of the change.
 *
 * This lives in the integration suite because it spawns `deno`, and because it
 * has to be immune to the permissions of the process running it: reading the
 * flags out of `deno.json` and handing them to a child is what makes the
 * assertion mean the same thing wherever it runs.
 *
 * @module tests/integration/unit-lane-egress
 */
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

/**
 * A host no provider deny-list ever carried, so reaching it was permitted
 * before the inversion and is refused after it.
 */
const UNNAMED_EXTERNAL_HOST = "cdn.jsdelivr.net";

const repoRoot = fromFileUrl(new URL("../../", import.meta.url));

async function readUnitLaneFlags(): Promise<string[]> {
  const config = JSON.parse(await readTextFile(join(repoRoot, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  const task = config.tasks["test:unit:parallel"];
  assert(typeof task === "string", "deno.json must define test:unit:parallel");

  const flags = task.split(/\s+/u).filter((token) =>
    token.startsWith("--allow-") || token.startsWith("--deny-")
  );
  assert(flags.length > 0, "test:unit:parallel must carry explicit permission flags");
  return flags;
}

describe("unit lane network permission", () => {
  it("refuses an external host that no provider deny-list ever named", async () => {
    const flags = await readUnitLaneFlags();
    assertEquals(
      flags.some((flag) => flag.startsWith("--deny-net")),
      false,
      "the provider deny-list must stay deleted",
    );
    assertEquals(flags.includes("--allow-all"), false);

    const dir = await makeTempDir();
    const fixture = join(dir, "egress-attempt.test.ts");
    await Deno.writeTextFile(
      fixture,
      `Deno.test("reaches an arbitrary external host", async () => {\n` +
        `  const response = await fetch("https://${UNNAMED_EXTERNAL_HOST}/");\n` +
        `  await response.body?.cancel();\n` +
        `});\n`,
    );

    const command = new Deno.Command("deno", {
      args: ["test", "--no-check", "--no-config", "--no-lock", ...flags, fixture],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await command.output();
    const decoder = new TextDecoder();
    // Deno reports a failing test case on stdout and the run's own errors on
    // stderr, and which one carries the refusal depends on where it surfaces.
    const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);

    assertEquals(result.success, false, `expected the attempt to be refused:\n${output}`);
    assertStringIncludes(output, "Requires net access");
    assertStringIncludes(output, UNNAMED_EXTERNAL_HOST);

    await Deno.remove(dir, { recursive: true });
  });

  it("still permits the loopback destinations tests bind", async () => {
    const flags = await readUnitLaneFlags();

    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => new Response("ok"),
    );
    const address = server.addr;
    assertEquals(address.transport, "tcp");
    const port = address.transport === "tcp" ? address.port : 0;

    const dir = await makeTempDir();
    const fixture = join(dir, "loopback-attempt.test.ts");
    await Deno.writeTextFile(
      fixture,
      `Deno.test("reaches a loopback server", async () => {\n` +
        `  const response = await fetch("http://127.0.0.1:${port}/");\n` +
        `  if ((await response.text()) !== "ok") throw new Error("unexpected body");\n` +
        `});\n`,
    );

    try {
      const command = new Deno.Command("deno", {
        args: ["test", "--no-check", "--no-config", "--no-lock", ...flags, fixture],
        stdout: "piped",
        stderr: "piped",
      });
      const result = await command.output();
      const decoder = new TextDecoder();
      assertEquals(
        result.success,
        true,
        decoder.decode(result.stdout) + decoder.decode(result.stderr),
      );
    } finally {
      await server.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  });
});
