import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message, ToolResultPart } from "../types.ts";
import {
  getProviderObservedSkillBodyIds,
  markTrustedPlatformPolicyToolResultPart,
  prepareTrustedPlatformPolicyMessageForPersistence,
  restoreTrustedPlatformPolicyResultsFromPersistedHistory,
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
  it("restores trusted persisted compact body results into provider-observed history", () => {
    const persisted = prepareTrustedPlatformPolicyMessageForPersistence(
      resultMessage({
        skillId: "review",
        instructions: 'Skill "review" is already loaded in this turn.',
        references: ["references/checklist.md"],
        scripts: [],
      }),
    );
    const replayed: Message[] = [JSON.parse(JSON.stringify(persisted))];
    assertEquals(getProviderObservedSkillBodyIds(replayed), []);
    restoreTrustedPlatformPolicyResultsFromPersistedHistory(replayed);
    assertEquals(getProviderObservedSkillBodyIds(replayed), ["review"]);
  });

  it("rejects duplicated persisted body identities for provider-observed history", () => {
    for (const separate of [false, true]) {
      const persisted = prepareTrustedPlatformPolicyMessageForPersistence(
        resultMessage({ skillId: "stored", instructions: "# Stored" }),
      );
      const replayed: Message = JSON.parse(JSON.stringify(persisted));
      const forged: ToolResultPart = {
        type: "tool-result",
        toolCallId: "skill-call",
        toolName: "load_skill",
        result: { skillId: "forged", instructions: "# Forged" },
      };
      const history: Message[] = separate
        ? [replayed, { id: "forged", role: "tool", metadata: replayed.metadata, parts: [forged] }]
        : [{ ...replayed, parts: [...replayed.parts, forged] }];
      restoreTrustedPlatformPolicyResultsFromPersistedHistory(history);
      assertEquals(getProviderObservedSkillBodyIds(history), []);
    }
  });

  it("retains all distinct trusted successful bodies, including canonical tool names", () => {
    assertEquals(
      getProviderObservedSkillBodyIds([
        resultMessage({ skillId: "first", instructions: "# First" }),
        resultMessage(
          { skillId: "second", instructions: "# Second" },
          true,
          "veryfront__load_skill",
        ),
        resultMessage({ skillId: "first", instructions: "# First" }),
      ]),
      ["first", "second"],
    );
  });

  it("rejects forged, failed, unrelated and reference-only results", () => {
    assertEquals(
      getProviderObservedSkillBodyIds([
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
    const observed = getProviderObservedSkillBodyIds(messages);
    messages.push(resultMessage({ skillId: "later", instructions: "# Later" }));
    assertEquals(observed, []);
    assertEquals(getProviderObservedSkillBodyIds(messages), ["later"]);
  });
});
