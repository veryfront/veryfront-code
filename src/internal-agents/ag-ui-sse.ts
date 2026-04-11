import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "../agent/ag-ui-browser-encoder.ts";
import {
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "../agent/ag-ui-browser-encoder.ts";
import { serverLogger } from "#veryfront/utils";
import { z } from "zod";

const encoder = new TextEncoder();
const logger = serverLogger.component("internal-agents-ag-ui-sse");

type RuntimeDataEvent = AgUiRuntimeStreamEvent;
export type RunFinishedMetadata = AgUiBrowserRunFinishedMetadata;
export type StreamTransformState = AgUiBrowserEncoderState;
export type MappedAgUiEvent = AgUiBrowserEncodedEvent;

export function createStreamTransformState(): StreamTransformState {
  return createAgUiBrowserEncoderState();
}

const agUiEventPayloadSchemas = {
  RunStarted: z.object({
    runId: z.string().min(1),
    threadId: z.string().min(1),
    agentId: z.string().min(1),
  }),
  StateSnapshot: z.object({
    snapshot: z.record(z.string(), z.unknown()),
  }),
  MessagesSnapshot: z.object({
    messages: z.array(z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant", "system", "tool"]),
      parts: z.array(z.record(z.string(), z.unknown())),
      metadata: z.record(z.string(), z.unknown()).optional(),
      createdAt: z.string().optional(),
    })),
  }),
  TextMessageStart: z.object({
    messageId: z.string().min(1),
    role: z.literal("assistant"),
  }),
  TextMessageContent: z.object({
    messageId: z.string().min(1),
    delta: z.string(),
  }),
  TextMessageEnd: z.object({
    messageId: z.string().min(1),
  }),
  ReasoningMessageStart: z.object({
    messageId: z.string().min(1),
    role: z.literal("reasoning"),
  }),
  ReasoningMessageContent: z.object({
    messageId: z.string().min(1),
    delta: z.string(),
  }),
  ReasoningMessageEnd: z.object({
    messageId: z.string().min(1),
  }),
  StepStarted: z.object({
    stepName: z.string().min(1),
  }),
  StepFinished: z.object({
    stepName: z.string().min(1),
  }),
  ToolCallStart: z.object({
    toolCallId: z.string().min(1),
    toolCallName: z.string().min(1),
  }),
  ToolCallArgs: z.object({
    toolCallId: z.string().min(1),
    delta: z.string(),
  }),
  ToolCallEnd: z.object({
    toolCallId: z.string().min(1),
  }),
  ToolCallResult: z.object({
    toolCallId: z.string().min(1),
    result: z.unknown(),
    isError: z.boolean().optional(),
  }),
  Custom: z.object({
    name: z.string().min(1),
    value: z.unknown(),
  }),
  RunError: z.object({
    code: z.string().min(1).optional(),
    message: z.string().min(1),
  }),
  RunFinished: z.object({
    metadata: z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      finishReason: z.string().optional(),
    }),
  }),
} as const satisfies Record<string, z.ZodType<Record<string, unknown>>>;

type AgUiEventName = keyof typeof agUiEventPayloadSchemas;

export function formatAgUiEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  const schema = agUiEventPayloadSchemas[event as AgUiEventName];
  const validatedPayload = schema ? schema.parse(payload) : payload;
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(validatedPayload)}\n\n`);
}

export function parseSseJsonEvents(chunk: string): {
  events: RuntimeDataEvent[];
  remainder: string;
} {
  const blocks = chunk.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    try {
      const payload = JSON.parse(dataLines.join("\n")) as RuntimeDataEvent;
      return [payload];
    } catch (error) {
      logger.warn("Skipping malformed runtime SSE event payload", {
        error,
        dataLength: dataLines.join("\n").length,
      });
      return [];
    }
  });

  return { events, remainder };
}

export function mapRuntimeEventToAgUi(
  state: StreamTransformState,
  event: RuntimeDataEvent,
): MappedAgUiEvent[] {
  return mapRuntimeStreamEventToAgUiBrowserEvents(state, event);
}

export function finalizeRunEvents(
  state: StreamTransformState,
  response: Parameters<typeof finalizeAgUiBrowserEvents>[1],
): MappedAgUiEvent[] {
  return finalizeAgUiBrowserEvents(state, response);
}
