import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseWorkerArgs } from "./handler.ts";

describe("commands/worker/handler", () => {
  it("defaults to the process runtime executor", () => {
    const parsed = parseWorkerArgs({ _: ["worker"] });

    assertEquals(parsed.success, true);
    if (parsed.success) {
      assertEquals(parsed.data.executor, "process");
    }
  });

  it("rejects kubernetes job execution as a public worker option", () => {
    const parsed = parseWorkerArgs({ _: ["worker"], executor: "k8s" });

    assertEquals(parsed.success, false);
    if (!parsed.success) {
      assertEquals(parsed.error.issues[0]?.message, 'Invalid input: expected "process"');
    }
  });
});
