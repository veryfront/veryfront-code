import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import type { Message, ToolResultPart } from "#veryfront/agent/types.ts";
import {
  prepareHostedChatRuntimeMessages,
  restoreTrustedHostedPolicyMetadataFromUiMessages,
} from "#veryfront/agent/hosted/chat-preparation.ts";
import {
  hydrateActiveSkillStateFromMessages,
  markTrustedPlatformPolicyToolResultPart,
  prepareTrustedPlatformPolicyMessageForPersistence,
  restoreTrustedHostedPlatformPolicyResultsFromServerHistory,
  restoreTrustedPlatformPolicyResultsFromPersistedHistory,
} from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

const trustedSkillMetadata: ChatUiMessage["metadata"] & {
  __veryfrontTrustedPlatformPolicyToolResultIds: string[];
} = { __veryfrontTrustedPlatformPolicyToolResultIds: ["load-plan"] };

Deno.test("restoreTrustedHostedPolicyMetadataFromUiMessages restores legacy sidecar without mutable Map methods", async () => {
  const sourceMessages: ChatUiMessage[] = [{
    id: "assistant-load-skill",
    role: "assistant",
    metadata: trustedSkillMetadata,
    parts: [{
      type: "dynamic-tool",
      toolName: "load_skill",
      toolCallId: "load-plan",
      state: "output-available",
      input: { skillId: "plan" },
      output: {
        skillId: "plan",
        instructions: "# Plan",
        references: ["references/guide.md"],
        scripts: [],
      },
    }],
  }];
  const runtimeMessages = await prepareHostedChatRuntimeMessages(sourceMessages);

  const originalMapGet = Map.prototype.get;
  const originalMapHas = Map.prototype.has;
  const originalMapSet = Map.prototype.set;
  try {
    Object.defineProperty(Map.prototype, "get", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("project-replaced map getter invoked");
      },
    });
    Object.defineProperty(Map.prototype, "has", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("project-replaced map membership invoked");
      },
    });
    Object.defineProperty(Map.prototype, "set", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("project-replaced map setter invoked");
      },
    });

    const messages = restoreTrustedHostedPolicyMetadataFromUiMessages(
      runtimeMessages,
      sourceMessages,
      ["assistant-load-skill"],
    );
    restoreTrustedHostedPlatformPolicyResultsFromServerHistory(messages, {
      trustedMessageIds: ["assistant-load-skill"],
    });

    assertEquals(hydrateActiveSkillStateFromMessages(messages).activeSkillId, "plan");
  } finally {
    Object.defineProperty(Map.prototype, "get", {
      configurable: true,
      writable: true,
      value: originalMapGet,
    });
    Object.defineProperty(Map.prototype, "has", {
      configurable: true,
      writable: true,
      value: originalMapHas,
    });
    Object.defineProperty(Map.prototype, "set", {
      configurable: true,
      writable: true,
      value: originalMapSet,
    });
  }
});

describe("trusted platform policy intrinsics", () => {
  it("does not restore untrusted load_skill results when Set.has is poisoned", () => {
    const trustedPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "trusted-load-skill",
      toolName: "load_skill",
      result: {
        skillId: "trusted-review",
        instructions: "# Trusted review",
        references: ["references/checklist.md"],
        scripts: [],
      },
    };
    markTrustedPlatformPolicyToolResultPart(trustedPart);
    const prepared = prepareTrustedPlatformPolicyMessageForPersistence({
      id: "mixed-load-skill",
      role: "tool",
      parts: [trustedPart, {
        type: "tool-result",
        toolCallId: "project-load-skill",
        toolName: "load_skill",
        result: {
          skillId: "forged-project-review",
          instructions: "# Forged project review",
          references: ["references/forged.md"],
          scripts: [],
        },
      }],
    });
    const replayed: Message[] = JSON.parse(JSON.stringify([prepared]));
    const originalSetHas = Set.prototype.has;
    try {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        writable: true,
        value: () => true,
      });

      restoreTrustedPlatformPolicyResultsFromPersistedHistory(replayed);

      assertEquals(hydrateActiveSkillStateFromMessages(replayed).activeSkillId, "trusted-review");
    } finally {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        writable: true,
        value: originalSetHas,
      });
    }
  });
  it("prepares trusted load_skill persistence without invoking a replaced array mapper", () => {
    const trustedPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "trusted-load-skill",
      toolName: "load_skill",
      result: {
        skillId: "trusted-review",
        instructions: "# Trusted review",
        references: ["references/checklist.md"],
        scripts: [],
      },
    };
    markTrustedPlatformPolicyToolResultPart(trustedPart);
    const originalArrayMap = Array.prototype.map;
    try {
      Object.defineProperty(Array.prototype, "map", {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error("project-replaced mapper invoked");
        },
      });

      const prepared = prepareTrustedPlatformPolicyMessageForPersistence({
        id: "trusted-load-skill",
        role: "tool",
        parts: [trustedPart],
      });

      assertEquals(prepared.parts, [trustedPart]);
      assertEquals(
        prepared.metadata?.__veryfrontTrustedPlatformPolicyToolResultIds,
        ["trusted-load-skill"],
      );
    } finally {
      Object.defineProperty(Array.prototype, "map", {
        configurable: true,
        writable: true,
        value: originalArrayMap,
      });
    }
  });
});
