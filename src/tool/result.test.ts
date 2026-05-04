import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasToolExecutionErrorMarker, isErroredToolExecutionResult } from "./result.ts";

describe("tool/result", () => {
  it("detects standard error markers on tool result objects", () => {
    assertEquals(hasToolExecutionErrorMarker({ error: "failed" }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: true }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: false }), false);
    assertEquals(hasToolExecutionErrorMarker({ error: { message: "failed" } }), false);
    assertEquals(hasToolExecutionErrorMarker("failed"), false);
  });

  it("detects errored execution results from direct or nested output markers", () => {
    assertEquals(isErroredToolExecutionResult({ error: "failed" }), true);
    assertEquals(isErroredToolExecutionResult({ isError: true }), true);
    assertEquals(isErroredToolExecutionResult({ output: { error: "failed" } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { isError: true } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { ok: true } }), false);
    assertEquals(isErroredToolExecutionResult({ ok: true }), false);
  });
});
