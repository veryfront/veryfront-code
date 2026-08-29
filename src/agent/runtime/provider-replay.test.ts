import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { Message } from "../types.ts";
import {
  applyProviderReplayCheckpointsToMessages,
  parseProviderReplayCheckpoint,
  parseServerResolvedProviderReplayCheckpoints,
  type ProviderReplayCheckpoint,
} from "./provider-replay.ts";
import { attachProviderMetadata, readAttachedProviderMetadata } from "./provider-metadata.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";

const SIGNATURE = "sig-secret-9f8e7d6c5b4a";
const REDACTED_DATA = "redacted-secret-0a1b2c3d";

function createValidCheckpoint(): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: "assistant-message-1",
    provider: "anthropic",
    providerBlocks: [
      {
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: SIGNATURE },
      },
      {
        type: "provider-block",
        provider: "anthropic",
        block: { type: "redacted_thinking", data: REDACTED_DATA },
      },
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "tool_use",
          id: "call-1",
          name: "lookup",
          input: { query: "veryfront" },
        },
      },
    ],
    providerBlockPositions: [0, 1, 2],
    totalPartCount: 3,
  };
}

function createTextCheckpoint(text: string): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: "assistant-message-1",
    provider: "anthropic",
    providerBlocks: [
      {
        type: "provider-block",
        provider: "anthropic",
        block: { type: "text", text },
      },
    ],
    providerBlockPositions: [0],
    totalPartCount: 1,
  };
}

function assertProviderReplayError(operation: () => unknown): VeryfrontError {
  const error = assertThrows(operation);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "provider-replay-checkpoint-invalid", "registry slug");
  return error;
}

function assertInvalidCheckpoint(mutate: (checkpoint: Record<string, unknown>) => void): void {
  const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
  mutate(checkpoint);
  const error = assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
  const serialized = JSON.stringify({
    message: error.message,
    detail: error.detail,
    context: error.context,
  });
  assertEquals(
    serialized.includes(SIGNATURE),
    false,
    "validation errors must never echo signed block material",
  );
  assertEquals(
    serialized.includes(REDACTED_DATA),
    false,
    "validation errors must never echo redacted block material",
  );
}

function createAssistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "reasoning", text: "" },
      { type: "text", text: "Looking that up." },
    ],
    timestamp: 1,
  } as Message;
}

function createCheckpointedAssistantMessage(id = "assistant-message-1"): Message {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "reasoning", signature: SIGNATURE },
      { type: "reasoning", redactedData: REDACTED_DATA },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        args: { query: "veryfront" },
      },
    ],
    timestamp: 1,
  } as Message;
}

describe("agent/runtime/provider-replay", () => {
  describe("parseProviderReplayCheckpoint", () => {
    it("should round-trip a valid multi-block checkpoint preserving block order", () => {
      const checkpoint = createValidCheckpoint();
      const parsed = parseProviderReplayCheckpoint(checkpoint);
      assertEquals(parsed, checkpoint, "parsed checkpoint equals input");
      assertEquals(
        parsed.providerBlocks.map((block) => block.block.type),
        ["thinking", "redacted_thinking", "tool_use"],
        "block order preserved",
      );
    });

    it("should accept optional elapsedMs and emittedAt stamps", () => {
      const checkpoint = { ...createValidCheckpoint(), elapsedMs: 12.5, emittedAt: 1756400000000 };
      const parsed = parseProviderReplayCheckpoint(checkpoint);
      assertEquals(parsed.elapsedMs, 12.5, "elapsedMs preserved");
      assertEquals(parsed.emittedAt, 1756400000000, "emittedAt preserved");
    });

    it("should reject a non-record payload", () => {
      for (const value of [null, undefined, "checkpoint", 1, [], true]) {
        assertProviderReplayError(() => parseProviderReplayCheckpoint(value));
      }
    });

    it("should reject an unsupported version", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.version = 2;
      });
    });

    it("should reject an invalid messageId", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.messageId = "";
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.messageId = "m".repeat(257);
      });
      assertInvalidCheckpoint((checkpoint) => {
        delete checkpoint.messageId;
      });
    });

    it("should reject an unknown provider", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.provider = "unknown-provider";
      });
    });

    it("should reject unknown keys smuggled onto the payload", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.injected = "value";
      });
    });

    it("should keep smuggled key names out of rejection text and context", () => {
      const smuggledKey = "sig-material-smuggled-as-key";
      const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
      checkpoint[smuggledKey] = true;
      const error = assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
      const serialized = JSON.stringify({
        message: error.message,
        detail: error.detail,
        context: error.context,
      });
      assertEquals(serialized.includes(smuggledKey), false, "unknown checkpoint key not echoed");

      const blockSmuggled = createValidCheckpoint() as unknown as {
        providerBlocks: Array<Record<string, unknown>>;
      };
      blockSmuggled.providerBlocks[0]![smuggledKey] = true;
      const blockError = assertProviderReplayError(() =>
        parseProviderReplayCheckpoint(blockSmuggled)
      );
      const blockSerialized = JSON.stringify({
        message: blockError.message,
        detail: blockError.detail,
        context: blockError.context,
      });
      assertEquals(blockSerialized.includes(smuggledKey), false, "unknown block key not echoed");
    });

    it("should reject empty, oversized, and malformed provider block lists", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [];
        checkpoint.providerBlockPositions = [];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = Array.from({ length: 101 }, () => ({
          type: "provider-block",
          provider: "anthropic",
          block: { type: "thinking", thinking: "", signature: SIGNATURE },
        }));
        checkpoint.providerBlockPositions = Array.from({ length: 101 }, (_, index) => index);
        checkpoint.totalPartCount = 101;
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [{ provider: "anthropic", block: {} }];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [{
          type: "provider-block",
          provider: "anthropic",
          block: "not-a-record",
        }];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [{
          type: "provider-block",
          provider: "anthropic",
          block: {},
          injected: true,
        }];
      });
    });

    it("should reject a block whose provider differs from the checkpoint provider", () => {
      assertInvalidCheckpoint((checkpoint) => {
        (checkpoint.providerBlocks as Array<Record<string, unknown>>)[0]!.provider =
          "openai-responses";
      });
    });

    it("should reject misaligned or non-increasing block positions", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [0, 1];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [0, 2, 1];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [0, 1, 1];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [-1, 0, 1];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [0, 1, 2.5];
      });
    });

    it("should reject positions and totals that disagree with totalPartCount", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlockPositions = [0, 1, 3];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.totalPartCount = 2;
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.totalPartCount = 10_001;
        checkpoint.providerBlockPositions = [0, 1, 2];
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.totalPartCount = 0;
      });
    });
  });

  describe("parseServerResolvedProviderReplayCheckpoints", () => {
    it("should parse a valid checkpoint array", () => {
      const checkpoint = createValidCheckpoint();
      assertEquals(
        parseServerResolvedProviderReplayCheckpoints([checkpoint]),
        [checkpoint],
        "array round trip",
      );
    });

    it("should reject a non-array delivery", () => {
      assertProviderReplayError(() =>
        parseServerResolvedProviderReplayCheckpoints(createValidCheckpoint())
      );
    });

    it("should reject an oversized checkpoint delivery", () => {
      const checkpoints = Array.from({ length: 101 }, (_, index) => ({
        ...createValidCheckpoint(),
        messageId: `assistant-message-${index}`,
      }));
      assertProviderReplayError(() => parseServerResolvedProviderReplayCheckpoints(checkpoints));
    });

    it("should reject duplicate checkpoints for one message anchor", () => {
      const error = assertProviderReplayError(() =>
        parseServerResolvedProviderReplayCheckpoints([
          createValidCheckpoint(),
          createValidCheckpoint(),
        ])
      );
      assertEquals(
        JSON.stringify({ message: error.message, context: error.context })
          .includes(SIGNATURE),
        false,
        "duplicate rejection never echoes signed block material",
      );
    });

    it("should reject the whole delivery when any entry is forged", () => {
      assertProviderReplayError(() =>
        parseServerResolvedProviderReplayCheckpoints([
          createValidCheckpoint(),
          { ...createValidCheckpoint(), provider: "forged" },
        ])
      );
    });
  });

  describe("applyProviderReplayCheckpointsToMessages", () => {
    it("should attach opaque replay metadata to the matching assistant turn", () => {
      const target = createCheckpointedAssistantMessage("assistant-message-1");
      const untouched = createAssistantMessage("assistant-message-2");
      const messages = [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }], timestamp: 0 },
        target,
        untouched,
      ] as Message[];
      const checkpoint = createValidCheckpoint();

      applyProviderReplayCheckpointsToMessages(messages, [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [checkpoint.providerBlocks.map((block) => block.block)],
          },
        },
        "raw blocks attached in original order",
      );
      assertEquals(
        readAttachedProviderMetadata(untouched),
        undefined,
        "turns without replay state stay untouched",
      );
      assertEquals(
        JSON.stringify(messages).includes("rawAssistantMessages"),
        false,
        "raw replay metadata never lands on the public message objects",
      );
    });

    it("should validate opaque reasoning against its transcript-visible projection", () => {
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "lookup",
          args: { query: "veryfront" },
        }],
        timestamp: 1,
      } as Message;
      const checkpoint = createValidCheckpoint();

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [checkpoint.providerBlocks.map((block) => block.block)],
          },
        },
        "private reasoning metadata may be absent from the transcript anchor",
      );
    });

    it("should attach an opaque-only checkpoint to its empty transcript anchor", () => {
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        ...createValidCheckpoint(),
        providerBlocks: createValidCheckpoint().providerBlocks.slice(0, 2),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [checkpoint.providerBlocks.map((block) => block.block)],
          },
        },
        "an opaque-only provider turn remains replayable without public reasoning fields",
      );
    });

    it("should validate supported provider tool uses against canonical transcript calls", () => {
      for (
        const providerBlock of [
          {
            type: "server_tool_use",
            id: "srvtool-code",
            name: "code_execution",
            input: { code: "1 + 1" },
            caller: { type: "direct" },
          },
          {
            type: "mcp_tool_use",
            id: "mcptool-echo",
            name: "echo",
            server_name: "example-mcp",
            input: { value: "hello" },
          },
        ]
      ) {
        const target = {
          id: "assistant-message-1",
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: providerBlock.id,
            toolName: providerBlock.name,
            args: providerBlock.input,
            providerExecuted: true,
          }],
          timestamp: 1,
        } as Message;
        const checkpoint: ProviderReplayCheckpoint = {
          version: 1,
          messageId: target.id,
          provider: "anthropic",
          providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerBlock }],
          providerBlockPositions: [0],
          totalPartCount: 1,
        };

        applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

        assertEquals(
          readAttachedProviderMetadata(target),
          { anthropic: { rawAssistantMessages: [[providerBlock]] } },
          `${providerBlock.type} reattaches through its canonical tool-call identity`,
        );
      }
    });

    it("should reject a provider tool checkpoint for a client-owned transcript call", () => {
      const providerBlock = {
        type: "server_tool_use",
        id: "srvtool-code",
        name: "code_execution",
        input: { code: "1 + 1" },
        caller: { type: "direct" },
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerBlock.id,
          toolName: providerBlock.name,
          args: providerBlock.input,
        }],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerBlock }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should be a no-op for empty or absent deliveries", () => {
      const target = createAssistantMessage("assistant-message-1");
      applyProviderReplayCheckpointsToMessages([target], undefined);
      applyProviderReplayCheckpointsToMessages([target], []);
      assertEquals(readAttachedProviderMetadata(target), undefined, "no metadata attached");
    });

    it("should skip a checkpoint whose assistant turn left the context", () => {
      const target = createAssistantMessage("assistant-message-1");
      applyProviderReplayCheckpointsToMessages(
        [target],
        [{ ...createValidCheckpoint(), messageId: "assistant-message-gone" }],
      );
      assertEquals(
        readAttachedProviderMetadata(target),
        undefined,
        "a dropped turn is not replayed, so it needs no replay state",
      );
    });

    it("should fail explicitly when the checkpoint targets a non-assistant message", () => {
      const messages = [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }], timestamp: 0 },
      ] as Message[];
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(messages, [
          { ...createValidCheckpoint(), messageId: "user-1" },
        ])
      );
    });

    it("should not treat matching ID prefixes as split-turn provenance", () => {
      const target = createAssistantMessage("assistant-message-1");
      const unrelated = createAssistantMessage("assistant-message-1-1");
      const checkpoint = createTextCheckpoint("Looking that up.");
      applyProviderReplayCheckpointsToMessages([target, unrelated], [checkpoint]);
      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [[{ type: "text", text: "Looking that up." }]],
          },
        },
        "the exact checkpoint target receives replay metadata",
      );
      assertEquals(
        readAttachedProviderMetadata(unrelated),
        undefined,
        "an unrelated valid message id with a shared prefix stays untouched",
      );
    });

    it("should fail explicitly on ambiguous duplicate message ids", () => {
      const messages = [
        createAssistantMessage("assistant-message-1"),
        createAssistantMessage("assistant-message-1"),
      ];
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(messages, [createValidCheckpoint()])
      );
    });

    it("should allow a matching tool message sibling for one assistant anchor", () => {
      const target = createAssistantMessage("assistant-message-1");
      const toolSibling = {
        id: "assistant-message-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "lookup",
          result: { matches: 1 },
        }],
        timestamp: 2,
      } as Message;
      const checkpoint = createTextCheckpoint("Looking that up.");

      applyProviderReplayCheckpointsToMessages([target, toolSibling], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [[{ type: "text", text: "Looking that up." }]],
          },
        },
        "the assistant anchor receives replay metadata despite a same-source tool sibling",
      );
      assertEquals(
        readAttachedProviderMetadata(toolSibling),
        undefined,
        "tool siblings with the same source id are not replay anchors",
      );
    });

    it("should fail explicitly when dense checkpoint blocks do not match the anchor", () => {
      const textOnlyTurn = createAssistantMessage("assistant-message-1");

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([textOnlyTurn], [createValidCheckpoint()])
      );
    });

    it("should fail explicitly for providers this runtime cannot reconstruct", () => {
      const checkpoint: ProviderReplayCheckpoint = {
        ...createValidCheckpoint(),
        provider: "openai-responses",
        providerBlocks: [{
          type: "provider-block",
          provider: "openai-responses",
          block: { type: "reasoning", id: "rs-1" },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [createAssistantMessage("assistant-message-1")],
          [checkpoint],
        )
      );
    });

    it("should keep fresher in-process replay metadata over a delivered checkpoint", () => {
      const target = createCheckpointedAssistantMessage("assistant-message-1");
      const inProcess = { anthropic: { rawAssistantMessages: [[{ type: "text", text: "live" }]] } };
      // Simulate the in-process attach that happens right after a streamed step.
      attachProviderMetadata(target, inProcess);
      applyProviderReplayCheckpointsToMessages([target], [createValidCheckpoint()]);
      assertEquals(
        readAttachedProviderMetadata(target),
        inProcess,
        "in-process metadata wins over the durable copy of the same turn",
      );
    });

    it("should fail explicitly on sparse checkpoints this runtime cannot reconstruct", () => {
      // Contract-valid but sparse: blocks at positions [0, 2] of a 3-part turn.
      // The blocks at the missing positions are unknown to this runtime, so a
      // wholesale raw replay would silently alter the assistant turn.
      const sparse: ProviderReplayCheckpoint = {
        ...createValidCheckpoint(),
        providerBlocks: createValidCheckpoint().providerBlocks.slice(0, 2),
        providerBlockPositions: [0, 2],
        totalPartCount: 3,
      };
      assertEquals(
        parseProviderReplayCheckpoint(sparse),
        sparse,
        "sparse checkpoints stay wire-contract valid",
      );
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [createAssistantMessage("assistant-message-1")],
          [sparse],
        )
      );
    });

    it("should fail explicitly when a split turn cannot carry replay state", () => {
      // An assistant turn with an inline tool result followed by more content
      // splits into multiple assistant segments during conversion; exact
      // replay metadata cannot be paired with either fragment.
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-lookup",
            toolCallId: "call-1",
            toolName: "lookup",
            args: { query: "veryfront" },
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookup",
            result: { matches: 1 },
          },
          { type: "text", text: "Found it." },
        ],
        timestamp: 1,
      } as Message;
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [createValidCheckpoint()])
      );
    });

    it("should reconstruct the provider request assistant turn through the runtime converter", () => {
      const target = createCheckpointedAssistantMessage("assistant-message-1");
      const checkpoint = createValidCheckpoint();
      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      const runtimeMessages = convertToTextGenerationRuntimeMessages([target]);
      const assistant = runtimeMessages.find((message) => message.role === "assistant");
      assertEquals(
        assistant && "providerMetadata" in assistant ? assistant.providerMetadata : undefined,
        {
          anthropic: {
            rawAssistantMessages: [checkpoint.providerBlocks.map((block) => block.block)],
          },
        },
        "provider request path receives the raw replay metadata",
      );
    });
  });
});
