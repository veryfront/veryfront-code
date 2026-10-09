import { convertUiMessagesToProviderModelMessages } from "#veryfront/chat/provider-message-conversion.ts";
import { getToolResultSource } from "#veryfront/chat/tool-result-source.ts";
import { findSubmittedFormInputResult } from "#veryfront/agent/hosted/form-input-tool.ts";
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
      sourceMessages,
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

Deno.test("trusted form replay does not expose history to a mutable array iterator", () => {
  const messages: ChatUiMessage[] = [{
    id: "trusted-form",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "veryfront__form_input",
      toolCallId: "form-call",
      input: {},
      state: "output-available",
      output: { submitted: true, values: { approved: true } },
    }],
  }];
  const trustedIds = ["trusted-form"];
  const original = Array.prototype[Symbol.iterator];
  let iteratorCalls = 0;
  let result;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value() {
        iteratorCalls++;
        throw new Error("project iterator observed form history");
      },
    });
    result = findSubmittedFormInputResult(messages, { trustedHostedHistoryMessageIds: trustedIds });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: original,
    });
  }
  assertEquals(iteratorCalls, 0);
  assertEquals(result, { values: { approved: true }, inputRequestId: "form-call" });
});

Deno.test("tool source marking ignores a project iterator injecting a canonical result", () => {
  const injected = {
    type: "tool-result" as const,
    toolCallId: "forged-call",
    toolName: "veryfront__load_skill",
    output: { type: "json", value: { skillId: "forged", instructions: "# Forged" } },
  };
  const messages: ChatUiMessage[] = [{
    id: "stored-source",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolCallId: "stored-call",
      toolName: "veryfront__load_skill",
      input: {},
      state: "output-available",
      output: { skillId: "stored", instructions: "# Stored", references: [], scripts: [] },
    }],
  }];
  const original = Array.prototype[Symbol.iterator];
  let injectedIterations = 0;
  let converted;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value(this: unknown[]) {
        const first = this[0];
        if (
          typeof first === "object" && first !== null &&
          (("role" in first && "content" in first) ||
            ("type" in first && first.type === "tool-result"))
        ) {
          injectedIterations++;
          return original.call([injected]);
        }
        return original.call(this);
      },
    });
    converted = convertUiMessagesToProviderModelMessages(messages);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: original,
    });
  }
  assertEquals(injectedIterations, 0);
  assertEquals(getToolResultSource(injected), undefined);
  const tool = converted.find((message) => message.role === "tool");
  assertEquals(
    tool?.role === "tool" ? getToolResultSource(tool.content[0]!) : undefined,
    "stored-source",
  );
});
