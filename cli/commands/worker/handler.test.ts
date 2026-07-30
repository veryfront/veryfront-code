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
      assertEquals(parsed.data.projectDir, undefined);
    }
  });

  it("accepts an explicit project directory", () => {
    const parsed = parseWorkerArgs({ _: ["worker"], "project-dir": "./app" });

    assertEquals(parsed.success, true);
    if (parsed.success) assertEquals(parsed.data.projectDir, "./app");
  });

  it("rejects kubernetes job execution as a public worker option", () => {
    const parsed = parseWorkerArgs({ _: ["worker"], executor: "k8s" });

    assertEquals(parsed.success, false);
    if (!parsed.success) {
      assertEquals(parsed.error.message, 'Invalid input: expected "process"');
    }
  });

  it("rejects unsafe concurrency and timer values", () => {
    assertEquals(parseWorkerArgs({ _: ["worker"], concurrency: 0 }).success, false);
    assertEquals(parseWorkerArgs({ _: ["worker"], "poll-interval": -1 }).success, false);
    assertEquals(
      parseWorkerArgs({ _: ["worker"], "stalled-threshold": 2_147_483_648 }).success,
      false,
    );
  });
});
