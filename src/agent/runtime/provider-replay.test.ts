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

    it("should reject malformed present thinking fields at the checkpoint boundary", () => {
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "thinking", thinking: ["not text"], signature: SIGNATURE },
        }];
        checkpoint.providerBlockPositions = [0];
        checkpoint.totalPartCount = 1;
      });
      assertInvalidCheckpoint((checkpoint) => {
        checkpoint.providerBlocks = [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "thinking", thinking: "visible reasoning", signature: 123 },
        }];
        checkpoint.providerBlockPositions = [0];
        checkpoint.totalPartCount = 1;
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

    it("should accept the record and string provider-result content shapes", () => {
      for (
        const block of [
          {
            type: "web_fetch_tool_result",
            tool_use_id: "srvtool-1",
            caller: { type: "direct" },
            content: {
              type: "web_fetch_result",
              url: "https://example.com/a",
              retrieved_at: "2026-01-01T00:00:00Z",
              content: {
                type: "document",
                source: { type: "text", media_type: "text/plain", data: "hi" },
              },
            },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtool-1",
            caller: { type: "direct" },
            content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
          },
          { type: "mcp_tool_result", tool_use_id: "srvtool-1", is_error: false, content: "ok" },
        ]
      ) {
        const checkpoint = parseProviderReplayCheckpoint({
          version: 1,
          messageId: "assistant-1",
          provider: "anthropic",
          providerBlocks: [{ type: "provider-block", provider: "anthropic", block }],
          providerBlockPositions: [0],
          totalPartCount: 1,
        });
        assertEquals(checkpoint.providerBlocks[0]?.block, block);
      }
    });

    it("should reject a provider-result content primitive", () => {
      assertProviderReplayError(() =>
        parseProviderReplayCheckpoint({
          version: 1,
          messageId: "assistant-1",
          provider: "anthropic",
          providerBlocks: [{
            type: "provider-block",
            provider: "anthropic",
            block: {
              type: "web_search_tool_result",
              tool_use_id: "srvtool-1",
              caller: { type: "direct" },
              content: 42,
            },
          }],
          providerBlockPositions: [0],
          totalPartCount: 1,
        })
      );
    });

    it("should reject malformed nested provider-result content without a transcript", () => {
      assertProviderReplayError(() =>
        parseProviderReplayCheckpoint({
          version: 1,
          messageId: "assistant-compacted-out",
          provider: "anthropic",
          providerBlocks: [{
            type: "provider-block",
            provider: "anthropic",
            block: {
              type: "mcp_tool_result",
              tool_use_id: "srvtool-mcp",
              is_error: false,
              content: [{ type: "text", text: 123 }],
            },
          }],
          providerBlockPositions: [0],
          totalPartCount: 1,
        })
      );
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

    it("should reject malformed non-result blocks even when their anchor is absent", () => {
      for (
        const block of [
          { type: "text" },
          { type: "redacted_thinking" },
          { type: "tool_use", id: "call-1", input: {} },
        ]
      ) {
        assertProviderReplayError(() =>
          parseServerResolvedProviderReplayCheckpoints([{
            version: 1,
            messageId: "assistant-message-gone",
            provider: "anthropic",
            providerBlocks: [{ type: "provider-block", provider: "anthropic", block }],
            providerBlockPositions: [0],
            totalPartCount: 1,
          }])
        );
      }
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

    it("should validate provider tool results by their provider-owned call correlation", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
        "provider result remains correlated to the canonical provider-owned call",
      );
    });

    it("should validate provider tool results from a matching tool sibling", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          args: providerCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const toolSibling = {
        id: "assistant-message-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          result: [],
          providerExecuted: true,
        }],
        timestamp: 2,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target, toolSibling], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
        "provider result siblings remain part of the anchored replay projection",
      );
    });

    it("should correlate provider tool results across checkpointed assistant turns", () => {
      const providerCall = {
        type: "mcp_tool_use",
        id: "mcptool-cross-turn",
        name: "echo",
        server_name: "example-mcp",
        input: { value: "hello" },
      };
      const providerResult = {
        type: "mcp_tool_result",
        tool_use_id: providerCall.id,
        is_error: false,
        content: "hello",
      };
      const callTurn = {
        id: "assistant-call",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          args: providerCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const resultTurn = {
        id: "assistant-result",
        role: "assistant",
        parts: [{
          type: "tool-result",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          result: "hello",
          providerExecuted: true,
        }],
        timestamp: 2,
      } as Message;
      const callCheckpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: callTurn.id,
        provider: "anthropic",
        providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerCall }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };
      const resultCheckpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: resultTurn.id,
        provider: "anthropic",
        providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerResult }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };

      applyProviderReplayCheckpointsToMessages(
        [callTurn, resultTurn],
        [callCheckpoint, resultCheckpoint],
      );

      assertEquals(
        readAttachedProviderMetadata(callTurn),
        { anthropic: { rawAssistantMessages: [[providerCall]] } },
      );
      assertEquals(
        readAttachedProviderMetadata(resultTurn),
        { anthropic: { rawAssistantMessages: [[providerResult]] } },
      );
    });

    it("should reject malformed provider tool-result blocks before attachment", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const malformedProviderResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: "not an array",
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, malformedProviderResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject a provider result that appears before its provider tool use", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerResult, providerCall].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject duplicate provider results for one provider tool use", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2],
        totalPartCount: 3,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject MCP provider results for server-owned tool uses", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const mismatchedMcpResult = {
        type: "mcp_tool_result",
        tool_use_id: providerCall.id,
        is_error: false,
        content: "ok",
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, mismatchedMcpResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject provider result content that lacks required provider fields", () => {
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: "srvtool-code",
            toolName: "code_execution",
            args: { code: "1 + 1" },
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "srvtool-code",
            toolName: "code_execution",
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-code",
        name: "code_execution",
        input: { code: "1 + 1" },
        caller: { type: "direct" },
      };
      const malformedProviderResult = {
        type: "code_execution_tool_result",
        tool_use_id: providerCall.id,
        content: { type: "code_execution_result" },
      };
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, malformedProviderResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject malformed web-search result entries at the checkpoint boundary", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const malformedProviderResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [{ type: "web_search_result", url: "https://veryfront.com" }],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, malformedProviderResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject web provider results with malformed callers", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "unknown" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject provider results whose payload differs from the transcript", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const transcriptResult = [{
        type: "web_search_result",
        url: "https://veryfront.com/actual",
        title: "Actual",
        encrypted_content: "actual",
        page_age: null,
      }];
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [{
          type: "web_search_result",
          url: "https://veryfront.com/stale",
          title: "Stale",
          encrypted_content: "stale",
          page_age: null,
        }],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: transcriptResult,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should normalize provider results before matching the transcript", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const transcriptResult = [{
        type: "web_search_result",
        url: "https://veryfront.com/actual",
        title: "Actual",
        pageAge: null,
        encryptedContent: "actual",
      }];
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [{
          type: "web_search_result",
          url: "https://veryfront.com/actual",
          title: "Actual",
          encrypted_content: "actual",
          page_age: null,
        }],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: transcriptResult,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
      );
    });

    it("should unwrap prepared JSON provider results before matching the transcript", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [{
          type: "web_search_result",
          url: "https://veryfront.com/actual",
          title: "Actual",
          encrypted_content: "actual",
          page_age: null,
        }],
      };
      const transcriptResult = [{
        type: "web_search_result",
        url: "https://veryfront.com/actual",
        title: "Actual",
        pageAge: null,
        encryptedContent: "actual",
      }];
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: { type: "json", value: transcriptResult },
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
      );
    });

    it("should normalize provider error results before matching the transcript", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search-error",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: {
          type: "web_search_tool_result_error",
          error_code: "max_uses_exceeded",
        },
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: {
              type: "json",
              value: {
                name: "AnthropicServerToolResultError",
                provider: "anthropic",
                code: "max_uses_exceeded",
                toolCallId: providerCall.id,
                toolName: providerCall.name,
              },
            },
            isError: true,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
      );
    });

    it("should reject outer provider tool-result error block types", () => {
      const variants: ReadonlyArray<{
        readonly toolName: string;
        readonly resultType: string;
        readonly content: Record<string, unknown>;
      }> = [
        {
          toolName: "web_search",
          resultType: "web_search_tool_result",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
        {
          toolName: "web_fetch",
          resultType: "web_fetch_tool_result",
          content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" },
        },
        {
          toolName: "code_execution",
          resultType: "code_execution_tool_result",
          content: { type: "code_execution_tool_result_error", error_code: "unavailable" },
        },
        {
          toolName: "bash_code_execution",
          resultType: "bash_code_execution_tool_result",
          content: {
            type: "bash_code_execution_tool_result_error",
            error_code: "output_file_too_large",
          },
        },
        {
          toolName: "text_editor_code_execution",
          resultType: "text_editor_code_execution_tool_result",
          content: {
            type: "text_editor_code_execution_tool_result_error",
            error_code: "file_not_found",
            error_message: null,
          },
        },
      ];

      for (const variant of variants) {
        const providerCall = {
          type: "server_tool_use",
          id: `srvtool-${variant.toolName}`,
          name: variant.toolName,
          input: { query: "provider replay" },
          caller: { type: "direct" },
        };
        const providerResult = (resultType: string) => ({
          type: resultType,
          tool_use_id: providerCall.id,
          caller: { type: "direct" },
          content: variant.content,
        });
        const createTarget = () =>
          ({
            id: "assistant-message-1",
            role: "assistant",
            parts: [
              {
                type: "tool-call",
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                args: providerCall.input,
                providerExecuted: true,
              },
              {
                type: "tool-result",
                toolCallId: providerCall.id,
                toolName: providerCall.name,
                result: {
                  type: "json",
                  value: {
                    name: "AnthropicServerToolResultError",
                    provider: "anthropic",
                    code: variant.content.error_code,
                    toolCallId: providerCall.id,
                    toolName: providerCall.name,
                  },
                },
                isError: true,
                providerExecuted: true,
              },
            ],
            timestamp: 1,
          }) as Message;
        const createCheckpoint = (resultType: string): ProviderReplayCheckpoint => ({
          version: 1,
          messageId: "assistant-message-1",
          provider: "anthropic",
          providerBlocks: [providerCall, providerResult(resultType)].map((block) => ({
            type: "provider-block" as const,
            provider: "anthropic" as const,
            block,
          })),
          providerBlockPositions: [0, 1],
          totalPartCount: 2,
        });

        // Anthropic never emits an outer `*_tool_result_error` block. Accepting one
        // here would defer the failure to request construction, where the provider
        // parser rejects the unsupported outer type with a bare TypeError.
        const rejected = createTarget();
        assertProviderReplayError(() =>
          applyProviderReplayCheckpointsToMessages(
            [rejected],
            [createCheckpoint(`${variant.resultType}_error`)],
          )
        );
        assertEquals(
          readAttachedProviderMetadata(rejected),
          undefined,
          `${variant.toolName} outer error block must not attach`,
        );

        // The real wire shape keeps the ordinary outer type and carries the error
        // record inside `content`; it must still replay.
        const accepted = createTarget();
        applyProviderReplayCheckpointsToMessages(
          [accepted],
          [createCheckpoint(variant.resultType)],
        );
        assertEquals(
          readAttachedProviderMetadata(accepted),
          {
            anthropic: {
              rawAssistantMessages: [[providerCall, providerResult(variant.resultType)]],
            },
          },
          `${variant.toolName} ordinary error result must replay`,
        );
      }
    });

    it("should reset provider-executed ids at transcript boundaries before matching anchors", () => {
      const reusedToolCallId = "reused-tool-call";
      const historicalProviderCall = {
        type: "server_tool_use",
        id: reusedToolCallId,
        name: "web_search",
        input: { query: "historical provider call" },
        caller: { type: "direct" },
      };
      const targetRawToolUse = {
        type: "tool_use",
        id: reusedToolCallId,
        name: "lookup",
        input: { query: "ordinary local call" },
      };
      const historicalAssistant = {
        id: "assistant-historical",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: historicalProviderCall.id,
          toolName: historicalProviderCall.name,
          args: historicalProviderCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const boundary = {
        id: "user-boundary",
        role: "user",
        parts: [{ type: "text", text: "new request" }],
        timestamp: 2,
      } as Message;
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: targetRawToolUse.id,
          toolName: targetRawToolUse.name,
          args: targetRawToolUse.input,
        }],
        timestamp: 3,
      } as Message;
      attachProviderMetadata(historicalAssistant, {
        anthropic: { rawAssistantMessages: [[historicalProviderCall]] },
      });
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: targetRawToolUse,
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };

      applyProviderReplayCheckpointsToMessages([historicalAssistant, boundary, target], [
        checkpoint,
      ]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[targetRawToolUse]] } },
      );
    });

    it("should reject provider results separated from their provider tool use by a transcript boundary", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-search",
        name: "web_search",
        input: { query: "provider replay" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const callTurn = {
        id: "assistant-call",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          args: providerCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const boundary = {
        id: "user-boundary",
        role: "user",
        parts: [{ type: "text", text: "new request" }],
        timestamp: 2,
      } as Message;
      const resultTurn = {
        id: "assistant-result",
        role: "assistant",
        parts: [{
          type: "tool-result",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          result: [],
          providerExecuted: true,
        }],
        timestamp: 3,
      } as Message;
      const callCheckpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: callTurn.id,
        provider: "anthropic",
        providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerCall }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };
      const resultCheckpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: resultTurn.id,
        provider: "anthropic",
        providerBlocks: [{ type: "provider-block", provider: "anthropic", block: providerResult }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [callTurn, boundary, resultTurn],
          [callCheckpoint, resultCheckpoint],
        )
      );
    });

    it("should reject a provider tool result without its provider-owned call", () => {
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: "srvtool-web-search",
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-result",
          toolCallId: providerResult.tool_use_id,
          toolName: "web_search",
          result: [],
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: providerResult,
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject provider tool results that do not match their tool use type", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-web-fetch",
        name: "web_fetch",
        input: { url: "https://veryfront.com/docs" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should reject malformed MCP result elements at the checkpoint boundary", () => {
      const providerCall = {
        type: "mcp_tool_use",
        id: "srvtool-mcp",
        name: "search_docs",
        server_name: "docs",
        input: { query: "provider replay" },
      };
      const providerResult = {
        type: "mcp_tool_result",
        tool_use_id: providerCall.id,
        is_error: false,
        content: [{ type: "image" }],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should normalize MCP result fields before matching the transcript", () => {
      const providerCall = {
        type: "mcp_tool_use",
        id: "srvtool-mcp",
        name: "search_docs",
        server_name: "docs",
        input: { query: "provider replay" },
      };
      const providerResult = {
        type: "mcp_tool_result",
        tool_use_id: providerCall.id,
        is_error: false,
        content: [{
          type: "text",
          text: "matched",
          provider_extension: "ignored by the durable projection",
        }],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [{ type: "text", text: "matched" }],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(readAttachedProviderMetadata(target), {
        anthropic: {
          rawAssistantMessages: [[providerCall, providerResult]],
        },
      });
    });

    it("should reject text-editor errors that omit error_message", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-text-editor",
        name: "text_editor_code_execution",
        input: { command: "view", path: "example.txt" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "text_editor_code_execution_tool_result",
        tool_use_id: providerCall.id,
        content: {
          type: "text_editor_code_execution_tool_result_error",
          error_code: "file_not_found",
        },
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: {
              name: "AnthropicServerToolResultError",
              provider: "anthropic",
              code: "file_not_found",
              toolCallId: providerCall.id,
              toolName: providerCall.name,
            },
            isError: true,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should accept a provider tool turn whose text was persisted as one concatenated part", () => {
      const leadingText = { type: "text", text: "Let me search. " };
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const trailingText = { type: "text", text: "Here is what I found." };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search. Here is what I found." },
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const blocks = [leadingText, providerCall, providerResult, trailingText];
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: blocks.map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2, 3],
        totalPartCount: 4,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [blocks] } },
        "split provider text matches the single persisted transcript text part",
      );
    });

    it("should preserve checkpoint raw assistant message boundaries", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const trailingText = { type: "text", text: "Found it." };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
          trailingText,
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult, trailingText].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2],
        providerMessageBlockCounts: [1, 2],
        totalPartCount: 3,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [[providerCall], [providerResult, trailingText]] } },
      );
      assertEquals(
        convertToTextGenerationRuntimeMessages([target]),
        [{
          role: "assistant",
          content: [{ type: "text", text: trailingText.text }],
          providerMetadata: {
            anthropic: { rawAssistantMessages: [[providerCall], [providerResult, trailingText]] },
          },
        }],
        "provider-executed blocks replay through raw metadata without duplicating transcript text",
      );
    });

    it("should attach split provider replay segments to same-source assistant turns", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const trailingText = { type: "text", text: "Found it." };
      const leadingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          args: providerCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const toolSibling = {
        id: "assistant-message-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          result: [],
          providerExecuted: true,
        }],
        timestamp: 2,
      } as Message;
      const trailingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [trailingText],
        timestamp: 3,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: "assistant-message-1",
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult, trailingText].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2],
        totalPartCount: 3,
      };

      applyProviderReplayCheckpointsToMessages(
        [leadingAssistant, toolSibling, trailingAssistant],
        [checkpoint],
      );

      assertEquals(
        readAttachedProviderMetadata(leadingAssistant),
        { anthropic: { rawAssistantMessages: [[providerCall]] } },
        "the leading assistant segment replays only its raw assistant blocks",
      );
      assertEquals(
        readAttachedProviderMetadata(trailingAssistant),
        { anthropic: { rawAssistantMessages: [[providerResult, trailingText]] } },
        "the trailing assistant segment carries the provider result before trailing text",
      );
      assertEquals(readAttachedProviderMetadata(toolSibling), undefined);
    });

    it("should group consecutive provider results with the trailing assistant segment", () => {
      const firstProviderCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "first" },
        caller: { type: "direct" },
      };
      const secondProviderCall = {
        type: "server_tool_use",
        id: "srvtool-2",
        name: "web_search",
        input: { query: "second" },
        caller: { type: "direct" },
      };
      const firstProviderResult = {
        type: "web_search_tool_result",
        tool_use_id: firstProviderCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const secondProviderResult = {
        type: "web_search_tool_result",
        tool_use_id: secondProviderCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const trailingText = { type: "text", text: "Found both." };
      const leadingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: firstProviderCall.id,
            toolName: firstProviderCall.name,
            args: firstProviderCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-call",
            toolCallId: secondProviderCall.id,
            toolName: secondProviderCall.name,
            args: secondProviderCall.input,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const toolSibling = {
        id: "assistant-message-1",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: firstProviderCall.id,
            toolName: firstProviderCall.name,
            result: [],
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: secondProviderCall.id,
            toolName: secondProviderCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 2,
      } as Message;
      const trailingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [trailingText],
        timestamp: 3,
      } as Message;
      const checkpointBlocks = [
        firstProviderCall,
        secondProviderCall,
        firstProviderResult,
        secondProviderResult,
        trailingText,
      ];
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: "assistant-message-1",
        provider: "anthropic",
        providerBlocks: checkpointBlocks.map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2, 3, 4],
        totalPartCount: 5,
      };

      applyProviderReplayCheckpointsToMessages(
        [leadingAssistant, toolSibling, trailingAssistant],
        [checkpoint],
      );

      assertEquals(
        readAttachedProviderMetadata(leadingAssistant),
        { anthropic: { rawAssistantMessages: [[firstProviderCall, secondProviderCall]] } },
        "the leading assistant segment keeps both provider calls together",
      );
      assertEquals(
        readAttachedProviderMetadata(trailingAssistant),
        {
          anthropic: {
            rawAssistantMessages: [[firstProviderResult, secondProviderResult, trailingText]],
          },
        },
        "consecutive provider results stay with the trailing assistant segment",
      );
      assertEquals(readAttachedProviderMetadata(toolSibling), undefined);
    });

    it("should preserve declared raw groups when attaching split same-source turns", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const trailingText = { type: "text", text: "Found it." };
      const leadingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          args: providerCall.input,
          providerExecuted: true,
        }],
        timestamp: 1,
      } as Message;
      const toolSibling = {
        id: "assistant-message-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: providerCall.id,
          toolName: providerCall.name,
          result: [],
          providerExecuted: true,
        }],
        timestamp: 2,
      } as Message;
      const trailingAssistant = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [trailingText],
        timestamp: 3,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: "assistant-message-1",
        provider: "anthropic",
        providerBlocks: [providerCall, providerResult, trailingText].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2],
        providerMessageBlockCounts: [2, 1],
        totalPartCount: 3,
      };

      applyProviderReplayCheckpointsToMessages(
        [leadingAssistant, toolSibling, trailingAssistant],
        [checkpoint],
      );

      assertEquals(
        readAttachedProviderMetadata(leadingAssistant),
        { anthropic: { rawAssistantMessages: [[providerCall, providerResult]] } },
        "the first same-source assistant keeps its declared raw provider-result sibling",
      );
      assertEquals(
        readAttachedProviderMetadata(trailingAssistant),
        { anthropic: { rawAssistantMessages: [[trailingText]] } },
        "the second same-source assistant keeps the declared trailing raw text group",
      );
      assertEquals(readAttachedProviderMetadata(toolSibling), undefined);
    });

    it("should match replay blocks against persisted assistant transcript order", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const trailingText = { type: "text", text: "Here is what I found." };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Here is what I found." },
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const blocks = [providerCall, trailingText];
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: blocks.map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        { anthropic: { rawAssistantMessages: [blocks] } },
        "raw replay order is retained after matching against normalized transcript order",
      );
    });

    it("should reject a provider tool turn whose concatenated text differs from the anchor", () => {
      const providerCall = {
        type: "server_tool_use",
        id: "srvtool-1",
        name: "web_search",
        input: { query: "q" },
        caller: { type: "direct" },
      };
      const providerResult = {
        type: "web_search_tool_result",
        tool_use_id: providerCall.id,
        caller: { type: "direct" },
        content: [],
      };
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search. Here is what I found." },
          {
            type: "tool-call",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            args: providerCall.input,
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: providerCall.id,
            toolName: providerCall.name,
            result: [],
            providerExecuted: true,
          },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [
          { type: "text", text: "Let me search. " },
          providerCall,
          providerResult,
          { type: "text", text: "Here is something else." },
        ].map((block) => ({
          type: "provider-block" as const,
          provider: "anthropic" as const,
          block,
        })),
        providerBlockPositions: [0, 1, 2, 3],
        totalPartCount: 4,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages([target], [checkpoint])
      );
    });

    it("should not attach any checkpoint metadata when a later anchor fails validation", () => {
      const validTarget = createCheckpointedAssistantMessage("assistant-message-1");
      const invalidTarget = createAssistantMessage("assistant-message-2");
      const invalidCheckpoint: ProviderReplayCheckpoint = {
        ...createValidCheckpoint(),
        messageId: invalidTarget.id,
      };

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [validTarget, invalidTarget],
          [createValidCheckpoint(), invalidCheckpoint],
        )
      );

      assertEquals(
        readAttachedProviderMetadata(validTarget),
        undefined,
        "a rejected delivery must not partially mutate earlier anchors",
      );
      assertEquals(readAttachedProviderMetadata(invalidTarget), undefined);
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

    it("should normalize transcript text blocks before matching the anchor", () => {
      const target = {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Hello world" },
        ],
        timestamp: 1,
      } as Message;
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: target.id,
        provider: "anthropic",
        providerBlocks: [
          { type: "provider-block", provider: "anthropic", block: { type: "text", text: "" } },
          {
            type: "provider-block",
            provider: "anthropic",
            block: { type: "text", text: "Hello " },
          },
          { type: "provider-block", provider: "anthropic", block: { type: "text", text: "world" } },
        ],
        providerBlockPositions: [0, 1, 2],
        totalPartCount: 3,
      };

      applyProviderReplayCheckpointsToMessages([target], [checkpoint]);

      assertEquals(
        readAttachedProviderMetadata(target),
        {
          anthropic: {
            rawAssistantMessages: [[
              { type: "text", text: "" },
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ]],
          },
        },
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

    it("should reject checkpoints for a provider that is not active for the current model", () => {
      const target = createCheckpointedAssistantMessage("assistant-message-1");

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [target],
          [createValidCheckpoint()],
          { activeProvider: "openai-responses" },
        )
      );
    });

    it("should reject checkpoints when the active model provider cannot replay them", () => {
      const target = createCheckpointedAssistantMessage("assistant-message-1");

      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(
          [target],
          [createValidCheckpoint()],
          { activeProvider: "unsupported" },
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

    it("should reject replay groups beyond the provider assistant-message limit", () => {
      const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
      checkpoint.providerBlocks = Array.from({ length: 7 }, (_, index) => ({
        type: "provider-block",
        provider: "anthropic",
        block: { type: "text", text: `segment ${index}` },
      }));
      checkpoint.providerBlockPositions = [0, 1, 2, 3, 4, 5, 6];
      checkpoint.providerMessageBlockCounts = [1, 1, 1, 1, 1, 1, 1];
      checkpoint.totalPartCount = 7;

      assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
    });

    it("should reject raw replay blocks beyond provider metadata bounds", () => {
      const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
      let nested: Record<string, unknown> = { value: "leaf" };
      for (let depth = 0; depth < 70; depth += 1) {
        nested = { nested };
      }
      checkpoint.providerBlocks = [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "text", text: "visible", nested },
      }];
      checkpoint.providerBlockPositions = [0];
      checkpoint.totalPartCount = 1;

      assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
    });

    it("should reject raw replay blocks beyond canonical JSON byte bounds", () => {
      const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
      checkpoint.providerBlocks = [{
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "text",
          text: "\0".repeat(1_400_000),
        },
      }];
      checkpoint.providerBlockPositions = [0];
      checkpoint.totalPartCount = 1;

      const error = assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
      assertEquals(
        error.detail,
        "checkpoint provider block exceeds raw metadata bounds",
      );
    });

    it("should reject aggregate raw replay metadata beyond provider metadata bounds", () => {
      const checkpoint = createValidCheckpoint() as unknown as Record<string, unknown>;
      const blocks = Array.from({ length: 100 }, (_, index) => ({
        type: "text",
        text: `segment ${index}`,
        retained: Array.from({ length: 700 }, (__, itemIndex) => itemIndex),
      }));
      checkpoint.providerBlocks = blocks.map((block) => ({
        type: "provider-block",
        provider: "anthropic",
        block,
      }));
      checkpoint.providerBlockPositions = blocks.map((_, index) => index);
      checkpoint.providerMessageBlockCounts = [blocks.length];
      checkpoint.totalPartCount = blocks.length;

      const error = assertProviderReplayError(() => parseProviderReplayCheckpoint(checkpoint));
      assertEquals(
        error.detail,
        "checkpoint raw assistant messages exceeds raw metadata bounds",
      );
    });

    it("should fail explicitly when one message internally splits replay state", () => {
      // One stored assistant turn with an inline tool result followed by more
      // content still cannot receive one exact metadata attachment: by the time
      // conversion splits it, no persisted sibling message exists for the
      // trailing segment.
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
