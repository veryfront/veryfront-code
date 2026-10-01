import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const replacements = [
  {
    name: "encoder prototype",
    source: "TextEncoder.prototype.encode = () => new Uint8Array([1]);",
  },
  { name: "Math.max", source: "Math.max = () => 0;" },
  {
    name: "typed-array length getter",
    source: `Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype), "length", {
      configurable: true,
      get: () => 0,
    });`,
  },
];

describe("constantTimeEqual shared-realm comparison", () => {
  for (const replacement of replacements) {
    it(`rejects unequal credentials after ${replacement.name} replacement in an isolated process`, async () => {
      const moduleUrl =
        new URL("../../../src/security/utils/constant-time.ts", import.meta.url).href;
      const source = `
        import { constantTimeEqual } from ${JSON.stringify(moduleUrl)};
        const a = "a".repeat(64);
        const b = "b".repeat(64);
        if (constantTimeEqual(a, b)) throw new Error("baseline accepted unequal credentials");
        ${replacement.source}
        if (constantTimeEqual(a, b)) throw new Error("replacement accepted unequal credentials");
        if (!constantTimeEqual(a, a)) throw new Error("replacement rejected equal credentials");
      `;
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--frozen", "--config=deno.json", source],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
    });
  }
});
