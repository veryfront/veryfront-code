import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("constantTimeEqual shared-realm encoding", () => {
  it("rejects unequal credentials after encoder prototype replacement in an isolated process", async () => {
    const moduleUrl = new URL("../../../src/security/utils/constant-time.ts", import.meta.url).href;
    const source = `
      import { constantTimeEqual } from ${JSON.stringify(moduleUrl)};
      const a = "a".repeat(64);
      const b = "b".repeat(64);
      if (constantTimeEqual(a, b)) throw new Error("baseline accepted unequal credentials");
      TextEncoder.prototype.encode = () => new Uint8Array([1]);
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
});
