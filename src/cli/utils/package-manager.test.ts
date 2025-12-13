import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("package-manager", () => {
  it("should export detectPackageManager function", async () => {
    const module = await import("./package-manager.ts");
    assertExists(module.detectPackageManager);
    assertEquals(typeof module.detectPackageManager, "function");
  });

  it("should export installDependencies function", async () => {
    const module = await import("./package-manager.ts");
    assertExists(module.installDependencies);
    assertEquals(typeof module.installDependencies, "function");
  });
});
