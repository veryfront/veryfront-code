import { z } from "zod";

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal("tool_call_delta"),
    id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_complete"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(),
    }),
  }),
  z.object({
    type: z.literal("finish"),
    finishReason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }),
  }),
]);

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

export class StreamEventEmitter {
  private encoder = new TextEncoder();

  constructor(private controller: ReadableStreamDefaultController) {}

  emit(event: Record<string, unknown>): void {
    this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  private emitToolEvent(
    type: string,
    toolCallId: string,
    extra: Record<string, unknown>,
    dynamic?: boolean,
  ): void {
    const event: Record<string, unknown> = { type, toolCallId, ...extra };
    if (dynamic) event.dynamic = true;
    this.emit(event);
  }

  emitStart(messageId: string): void {
    this.emit({ type: "start", messageId });
  }

  emitTextStart(id: string): void {
    this.emit({ type: "text-start", id });
  }

  emitTextDelta(id: string, delta: string): void {
    this.emit({ type: "text-delta", id, delta });
  }

  emitTextEnd(id: string): void {
    this.emit({ type: "text-end", id });
  }

  emitToolInputStart(toolCallId: string, toolName: string, dynamic?: boolean): void {
    this.emitToolEvent("tool-input-start", toolCallId, { toolName }, dynamic);
  }

  emitToolInputDelta(toolCallId: string, inputTextDelta: string): void {
    this.emit({ type: "tool-input-delta", toolCallId, inputTextDelta });
  }

  emitToolInputAvailable(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    dynamic?: boolean,
  ): void {
    this.emitToolEvent("tool-input-available", toolCallId, { toolName, input }, dynamic);
  }

  emitToolOutputAvailable(toolCallId: string, output: unknown, dynamic?: boolean): void {
    this.emitToolEvent("tool-output-available", toolCallId, { output }, dynamic);
  }

  emitToolOutputError(toolCallId: string, errorText: string, dynamic?: boolean): void {
    this.emitToolEvent("tool-output-error", toolCallId, { errorText }, dynamic);
  }

  emitToolInputError(toolCallId: string, errorText: string, dynamic?: boolean): void {
    this.emitToolEvent("tool-input-error", toolCallId, { errorText }, dynamic);
  }

  emitFinish(): void {
    this.emit({ type: "finish" });
  }

  emitError(error: string): void {
    this.emit({ type: "error", error });
  }

  emitStartStep(): void {
    this.emit({ type: "start-step" });
  }

  emitFinishStep(): void {
    this.emit({ type: "finish-step" });
  }
}
