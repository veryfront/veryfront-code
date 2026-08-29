import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { Message } from "../types.ts";
import {
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
  applyProviderReplayCheckpointsToMessages,
  createAnthropicProviderReplayCheckpoint,
  createProviderReplayCheckpointEvent,
  isProviderReplayCheckpointEmissionEnabled,
  maybeCreateProviderReplayCheckpointEvent,
  parseProviderReplayCheckpoint,
  parseServerResolvedProviderReplayCheckpoints,
  PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV_FLAG,
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

    it("should reject the whole delivery when any entry is forged", () => {
      assertProviderReplayError(() =>
        parseServerResolvedProviderReplayCheckpoints([
          createValidCheckpoint(),
          { ...createValidCheckpoint(), provider: "forged" },
        ])
      );
    });
  });

  describe("createProviderReplayCheckpointEvent", () => {
    it("should stamp the durable event type onto a valid checkpoint", () => {
      const checkpoint = createValidCheckpoint();
      const event = createProviderReplayCheckpointEvent(checkpoint);
      assertEquals(event.type, AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE, "event type");
      const { type: _type, ...payload } = event;
      assertEquals(payload, checkpoint, "event payload round trip");
    });

    it("should refuse to mint an event from a malformed checkpoint", () => {
      assertProviderReplayError(() =>
        createProviderReplayCheckpointEvent(
          { ...createValidCheckpoint(), version: 9 } as unknown as ProviderReplayCheckpoint,
        )
      );
    });
  });

  describe("emission gate", () => {
    it("should default to disabled when the flag is unset", () => {
      assertEquals(
        isProviderReplayCheckpointEmissionEnabled(() => undefined),
        false,
        "unset flag stays off",
      );
      assertEquals(isProviderReplayCheckpointEmissionEnabled(), false, "real environment default");
    });

    it("should only enable on the exact literal true", () => {
      for (const value of ["1", "TRUE", "yes", "on", ""]) {
        assertEquals(
          isProviderReplayCheckpointEmissionEnabled(() => value),
          false,
          `"${value}" stays off`,
        );
      }
      assertEquals(
        isProviderReplayCheckpointEmissionEnabled((name) =>
          name === PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV_FLAG ? "true" : undefined
        ),
        true,
        "literal true enables",
      );
    });

    it("should emit nothing while the gate is off", () => {
      assertEquals(
        maybeCreateProviderReplayCheckpointEvent({
          checkpoint: createValidCheckpoint(),
          readEnv: () => undefined,
        }),
        null,
        "gate off emits nothing",
      );
      assertEquals(
        maybeCreateProviderReplayCheckpointEvent({ checkpoint: createValidCheckpoint() }),
        null,
        "gate off by default in this environment",
      );
    });

    it("should mint the event only when the gate is on", () => {
      const event = maybeCreateProviderReplayCheckpointEvent({
        checkpoint: createValidCheckpoint(),
        readEnv: () => "true",
      });
      assertEquals(
        event?.type,
        AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
        "gate on emits the event",
      );
    });
  });

  describe("createAnthropicProviderReplayCheckpoint", () => {
    it("should return null when no provider metadata is present", () => {
      assertEquals(
        createAnthropicProviderReplayCheckpoint({
          messageId: "assistant-message-1",
          providerMetadata: undefined,
        }),
        null,
        "absent metadata",
      );
      assertEquals(
        createAnthropicProviderReplayCheckpoint({
          messageId: "assistant-message-1",
          providerMetadata: { google: { rawAssistantParts: [] } },
        }),
        null,
        "non-anthropic metadata is not replay-required",
      );
    });

    it("should build a checkpoint from raw assistant messages preserving order", () => {
      const rawAssistantMessages = [
        [
          { type: "thinking", thinking: "", signature: SIGNATURE },
          { type: "tool_use", id: "call-1", name: "lookup", input: { query: "veryfront" } },
        ],
        [
          { type: "text", text: "continued" },
        ],
      ];
      const checkpoint = createAnthropicProviderReplayCheckpoint({
        messageId: "assistant-message-1",
        providerMetadata: { anthropic: { rawAssistantMessages } },
      });
      assertEquals(checkpoint?.provider, "anthropic", "provider");
      assertEquals(checkpoint?.messageId, "assistant-message-1", "message anchor");
      assertEquals(checkpoint?.totalPartCount, 3, "total part count");
      assertEquals(checkpoint?.providerBlockPositions, [0, 1, 2], "positions");
      assertEquals(
        checkpoint?.providerBlocks.map((block) => block.block),
        [...rawAssistantMessages[0]!, ...rawAssistantMessages[1]!],
        "blocks flattened in original order",
      );
      assertEquals(
        checkpoint?.providerBlocks[0]?.block.signature,
        SIGNATURE,
        "signature carried byte-exact beside empty thinking text",
      );
      assertEquals(checkpoint?.providerBlocks[0]?.block.thinking, "", "empty displayed thinking");
      assertEquals(
        parseProviderReplayCheckpoint(checkpoint),
        checkpoint,
        "emitted checkpoint satisfies the wire contract",
      );
    });

    it("should fail explicitly on malformed raw assistant metadata", () => {
      for (
        const anthropic of [
          { rawAssistantMessages: [] },
          { rawAssistantMessages: "not-an-array" },
          { rawAssistantMessages: [["not-a-block"]] },
          { rawAssistantMessages: [[{ thinking: "missing type" }]] },
        ]
      ) {
        assertProviderReplayError(() =>
          createAnthropicProviderReplayCheckpoint({
            messageId: "assistant-message-1",
            providerMetadata: { anthropic },
          })
        );
      }
    });

    it("should fail explicitly when the turn exceeds the checkpoint block capacity", () => {
      assertProviderReplayError(() =>
        createAnthropicProviderReplayCheckpoint({
          messageId: "assistant-message-1",
          providerMetadata: {
            anthropic: {
              rawAssistantMessages: [
                Array.from({ length: 101 }, () => ({ type: "text", text: "block" })),
              ],
            },
          },
        })
      );
    });
  });

  describe("applyProviderReplayCheckpointsToMessages", () => {
    it("should attach opaque replay metadata to the matching assistant turn", () => {
      const target = createAssistantMessage("assistant-message-1");
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
        JSON.stringify(messages).includes(SIGNATURE),
        false,
        "signed material never lands on the public message objects",
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

    it("should fail explicitly on ambiguous duplicate message ids", () => {
      const messages = [
        createAssistantMessage("assistant-message-1"),
        createAssistantMessage("assistant-message-1"),
      ];
      assertProviderReplayError(() =>
        applyProviderReplayCheckpointsToMessages(messages, [createValidCheckpoint()])
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
      const target = createAssistantMessage("assistant-message-1");
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

    it("should reconstruct the provider request assistant turn through the runtime converter", () => {
      const target = createAssistantMessage("assistant-message-1");
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
