/**
 * NodeBasedShellAdapter file decoding integration test.
 *
 * Writing a fixture file to the host filesystem is a filesystem effect, so the
 * exact-content decoding check lives here rather than beside the adapter.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeBasedShellAdapter } from "#veryfront/platform/adapters/runtime/shared/node-based-shell-adapter.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

describe("NodeBasedShellAdapter.readFileSync against the host filesystem", () => {
  it("returns the file decoded as UTF-8 text", async () => {
    const directory = await makeTempDir({ prefix: "vf-node-shell-read-" });

    try {
      const path = `${directory}/sample.txt`;
      const expected = 'héllo 世界\n{"name":"veryfront"}\n';
      await Deno.writeTextFile(path, expected);

      assertEquals(
        new NodeBasedShellAdapter().readFileSync(path),
        expected,
        "readFileSync must return the file decoded as UTF-8 text",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
