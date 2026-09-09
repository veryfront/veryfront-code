import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectAnthropicProviderToolCallIds,
  groupAnthropicRawAssistantMessagesByAnchor,
} from "./anthropic-provider-replay-block.ts";

describe("Anthropic replay block collections", () => {
  it("reads provider block groups without consulting their own iterators", () => {
    const blocks = [{
      type: "server_tool_use",
      id: "call",
      input: { text: "synthetic private block" },
    }];
    const groups = [blocks];
    let observations = 0;
    for (const value of [groups, blocks]) {
      Object.defineProperty(value, Symbol.iterator, {
        get() {
          observations++;
          return Array.prototype[Symbol.iterator];
        },
      });
    }
    assertEquals([...collectAnthropicProviderToolCallIds(groups)], ["call"]);
    assertEquals(groupAnthropicRawAssistantMessagesByAnchor(groups, 1), [[blocks]]);
    assertEquals(observations, 0);
  });
});
