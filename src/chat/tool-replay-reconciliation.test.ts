import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findProviderVisibleToolReplayMatches,
  isTransientToolState,
} from "./tool-replay-reconciliation.ts";

describe("tool-replay-reconciliation", () => {
  it("classifies in-flight states as transient", () => {
    assertEquals(isTransientToolState("input-streaming"), true);
    assertEquals(isTransientToolState("approval-requested"), true);
    assertEquals(isTransientToolState("output-available"), false);
    assertEquals(isTransientToolState(undefined), false);
  });

  it("returns an empty match set for empty history", () => {
    const matches = findProviderVisibleToolReplayMatches([]);
    assertEquals(typeof matches.preservedTransientToolParts.has, "function");
    assertEquals(typeof matches.matchedToolResultNames.get, "function");
    assertEquals(matches.matchedToolCallParts.has({}), false);
    assertEquals(matches.supersededToolResultParts.has({}), false);
  });
});
