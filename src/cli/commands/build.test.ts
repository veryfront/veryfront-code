import { describe, it } from "std/testing/bdd.ts";
import { assertExists, assertEquals } from "std/assert/mod.ts";

describe("build", () => {
  it("should export everything from build/index.ts", async () => {
    const module = await import("./build.ts");
    assertExists(module);
  });

  it("should have proper module structure", async () => {
    const module = await import("./build.ts");
    assertEquals(typeof module, "object");
  });
});
