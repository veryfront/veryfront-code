import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { vfBootstrap } from "./bootstrap-tool.ts";

describe("mcp/tools/bootstrap-tool", () => {
  it("has correct tool name", () => {
    assertEquals(vfBootstrap.name, "vf_bootstrap");
  });

  it("has description mentioning session or bootstrap", () => {
    assertExists(vfBootstrap.description);
    assertEquals(
      vfBootstrap.description.includes("session") ||
        vfBootstrap.description.includes("bootstrap"),
      true,
    );
  });

  it("has execute function", () => {
    assertEquals(typeof vfBootstrap.execute, "function");
  });

  it("has correct annotations — read-only, idempotent", () => {
    assertEquals(vfBootstrap.annotations?.readOnlyHint, true);
    assertEquals(vfBootstrap.annotations?.destructiveHint, false);
    assertEquals(vfBootstrap.annotations?.idempotentHint, true);
    assertEquals(vfBootstrap.annotations?.openWorldHint, false);
  });

  it("has title", () => {
    assertEquals(vfBootstrap.title, "Bootstrap");
  });

  it("returns object with expected top-level keys", async () => {
    const result = await vfBootstrap.execute({});
    assertExists(result.project);
    assertExists(result.conventions);
    assertExists(result.errors);
    assertExists(result.status);
  });
});
