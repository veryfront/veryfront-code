import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("safe-diagnostics browser boundary", () => {
  it("keeps the public sanitizer free of static Node built-ins", async () => {
    const source = await Deno.readTextFile(
      new URL("../../../../../src/errors/safe-diagnostics.ts", import.meta.url),
    );
    assertEquals(/(?:from|import\s*\()\s*["']node:/.test(source), false);
  });
});
