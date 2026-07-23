import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("platform/polyfills/node-noop", () => {
  it("matches the compiled polyfill's default-only module contract", async () => {
    const module = await import("./node-noop.ts");

    assertEquals(Object.keys(module), ["default"]);
    assertEquals(module.default, {});
  });
});
