import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message, ToolResultPart } from "../types.ts";
import {
  getProviderObservedSkillBodies,
  markTrustedPlatformPolicyToolResultPart,
  prepareTrustedPlatformPolicyMessageForPersistence,
  restoreTrustedPlatformPolicyResultsFromPersistedHistory,
  snapshotTrustedSkillLoadResults,
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
    assertEquals(getProviderObservedSkillBodies(replayed), []);
    restoreTrustedPlatformPolicyResultsFromPersistedHistory(replayed);
    assertEquals(getProviderObservedSkillBodies(replayed), [
      { skillId: "review", references: ["references/checklist.md"] },
    ]);
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
      assertEquals(getProviderObservedSkillBodies(history), []);
    }
  });

  it("snapshots only unambiguous trusted load_skill results for executor history seeding", () => {
    const trusted = resultMessage({ skillId: "stored", instructions: "# Stored" });
    const duplicateUntrusted: Message = {
      id: "duplicate-untrusted",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "skill-call",
        toolName: "load_skill",
        result: { skillId: "stored", instructions: "# Stored" },
      }],
    };
    assertEquals(snapshotTrustedSkillLoadResults([trusted]), [{
      toolCallId: "skill-call",
      toolName: "load_skill",
      result: { skillId: "stored", instructions: "# Stored" },
    }]);
    assertEquals(snapshotTrustedSkillLoadResults([trusted, duplicateUntrusted]), []);
    assertEquals(
      snapshotTrustedSkillLoadResults([
        trusted,
        {
          id: "duplicate-malformed",
          role: "tool",
          parts: [{ type: "tool-result", toolCallId: "skill-call" }],
        } as unknown as Message,
      ]),
      [],
    );
    assertEquals(
      snapshotTrustedSkillLoadResults([
        resultMessage({ skillId: "stored", file: "references/checklist.md", content: "body" }),
      ]),
      [],
    );
  });

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
