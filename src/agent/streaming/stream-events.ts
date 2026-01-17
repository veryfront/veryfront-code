/**
 * Stream Event Schemas and Types
 *
 * Defines the event format for agent streaming responses.
 * Compatible with Vercel AI SDK Data Stream Protocol.
 */

import { z } from "zod";

/**
 * Schema for agent stream events
 */
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

/**
 * Stream event emitter helper
 */
export class StreamEventEmitter {
  private encoder: TextEncoder;
  private controller: ReadableStreamDefaultController;

  constructor(controller: ReadableStreamDefaultController) {
    this.encoder = new TextEncoder();
    this.controller = controller;
  }

  /**
   * Emit an SSE-formatted event
   */
  emit(event: Record<string, unknown>): void {
    const data = JSON.stringify(event);
    this.controller.enqueue(this.encoder.encode(`data: ${data}\n\n`));
  }

  /**
   * Helper to emit tool events with optional dynamic flag
   */
  private emitToolEvent(
    type: string,
    toolCallId: string,
    extra: Record<string, unknown>,
    dynamic?: boolean,
  ): void {
    this.emit({
      type,
      toolCallId,
      ...extra,
      ...(dynamic && { dynamic: true }),
    });
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
