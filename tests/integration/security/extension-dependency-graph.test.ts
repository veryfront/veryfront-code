import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("sandbox and CSS dependency security", () => {
  it("keeps the unpatched braces chain out of the committed runtime graph", async () => {
    const lock = JSON.parse(
      await Deno.readTextFile(new URL("../../../deno.lock", import.meta.url)),
    );
    const vulnerable = Object.keys(lock.npm).filter((name) => name.startsWith("braces@"));
    assertEquals(
      vulnerable,
      [],
      "The vulnerable braces chain must stay out of the runtime graph",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../extensions/ext-sandbox-shell-tools/deno.json",
          import.meta.url,
        ),
      ),
    );
    assertEquals(manifest.imports["bash-tool"], undefined);
  });
});
