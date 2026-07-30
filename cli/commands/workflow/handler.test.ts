import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseWorkflowArgs } from "./handler.ts";

describe("commands/workflow/handler", () => {
  it("defaults to the explicit local-memory backend", () => {
    const parsed = parseWorkflowArgs({ _: ["workflow", "run", "publish"] });

    assertEquals(parsed.success, true);
    if (parsed.success) assertEquals(parsed.data.backend, "memory");
  });

  it("accepts the provider-neutral distributed backend selector", () => {
    const parsed = parseWorkflowArgs({
      _: ["workflow", "run", "publish"],
      backend: "distributed",
    });

    assertEquals(parsed.success, true);
    if (parsed.success) assertEquals(parsed.data.backend, "distributed");
  });

  it("rejects vendor-specific backend selectors", () => {
    const parsed = parseWorkflowArgs({
      _: ["workflow", "run", "publish"],
      backend: "redis",
    });

    assertEquals(parsed.success, false);
  });
});
