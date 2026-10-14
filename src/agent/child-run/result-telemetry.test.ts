import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { boundChildResultTelemetry } from "./result-telemetry.ts";

describe("child result telemetry budget", () => {
  it("preserves admitted large JSON and identity", () => {
    const result = {
      output: Array.from({ length: 10_001 }, (_, index) => index),
      toolCalls: [],
      toolResults: [],
    };
    assertStrictEquals(boundChildResultTelemetry(result), result);
  });
  it("does not admit an oversized accepted response by dropping telemetry", () => {
    const result = { output: "界".repeat(2_000_000), toolCalls: [], toolResults: [] };
    assertStrictEquals(boundChildResultTelemetry(result), result);
    assertEquals(snapshotBoundedJsonValue(result).success, false);
  });
  it("does not execute trace identity accessors", () => {
    let reads = 0;
    const call = {
      get toolName() {
        reads += 1;
        return "example";
      },
      toolCallId: "call",
      input: null,
    };
    const result = { output: "accepted", toolCalls: [call], toolResults: [] };
    assertStrictEquals(boundChildResultTelemetry(result), result);
    assertEquals(reads, 0);
  });
  it("bounds aggregate nodes and reports omitted trace entries", () => {
    const toolCalls = Array.from({ length: 35_000 }, (_, index) => ({
      toolName: "example",
      toolCallId: String(index),
      input: index,
    }));
    const result = { output: { accepted: true }, toolCalls, toolResults: [] };
    const bounded = boundChildResultTelemetry(result);
    assertEquals(snapshotBoundedJsonValue(bounded).success, true);
    assertStrictEquals(bounded.output, result.output);
    assertEquals(bounded.toolTelemetryOmitted?.calls, toolCalls.length - bounded.toolCalls.length);
    assertEquals(bounded.toolTelemetryOmitted?.results, 0);
    assertEquals(result.toolCalls.length, 35_000);
  });
});
