import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message, ToolResultPart } from "../types.ts";
import {
  getProviderObservedSkillBodies,
  markTrustedPlatformPolicyToolResultPart,
} from "./skill-policy-enforcement.ts";

function resultMessage(result: unknown, trusted = true, toolName = "load_skill"): Message {
  const part: ToolResultPart = {
    type: "tool-result",
    toolCallId: "skill-call",
    toolName,
    result,
  };
  return {
    id: "skill-result",
    role: "tool",
    parts: [trusted ? markTrustedPlatformPolicyToolResultPart(part) : part],
  };
}

describe("provider-observed skill body history", () => {
  it("retains trusted successful bodies with their references, including canonical tool names", () => {
    assertEquals(
      getProviderObservedSkillBodies([
        resultMessage({
          skillId: "first",
          instructions: "# First",
          references: ["references/guide.md"],
        }),
        resultMessage(
          { skillId: "second", instructions: "# Second" },
          true,
          "veryfront__load_skill",
        ),
      ]),
      [
        { skillId: "first", references: ["references/guide.md"] },
        { skillId: "second", references: [] },
      ],
    );
  });

  it("rejects forged, failed, unrelated and reference-only results", () => {
    assertEquals(
      getProviderObservedSkillBodies([
        resultMessage({ skillId: "forged", instructions: "# Forged" }, false),
        resultMessage({ skillId: "failed", instructions: "# Failed", error: "failed" }),
        resultMessage({ skillId: "other", instructions: "# Other" }, true, "other_tool"),
        resultMessage({ skillId: "reference", file: "references/guide.md", content: "guide" }),
      ]),
      [],
    );
  });

  it("returns a snapshot unaffected by later results in the same provider step", () => {
    const messages: Message[] = [];
    const observed = getProviderObservedSkillBodies(messages);
    messages.push(resultMessage({ skillId: "later", instructions: "# Later" }));
    assertEquals(observed, []);
    assertEquals(getProviderObservedSkillBodies(messages), [{ skillId: "later", references: [] }]);
  });
});
