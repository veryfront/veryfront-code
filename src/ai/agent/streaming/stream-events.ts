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
   * Emit a start event
   */
  emitStart(messageId: string): void {
    this.emit({ type: "start", messageId });
  }

  /**
   * Emit a text-start event
   */
  emitTextStart(id: string): void {
    this.emit({ type: "text-start", id });
  }

  /**
   * Emit a text-delta event
   */
  emitTextDelta(id: string, delta: string): void {
    this.emit({ type: "text-delta", id, delta });
  }

  /**
   * Emit a text-end event
   */
  emitTextEnd(id: string): void {
    this.emit({ type: "text-end", id });
  }

  /**
   * Emit a tool-input-start event
   */
  emitToolInputStart(toolCallId: string, toolName: string, dynamic?: boolean): void {
    this.emit({
      type: "tool-input-start",
      toolCallId,
      toolName,
      ...(dynamic && { dynamic: true }),
    });
  }

  /**
   * Emit a tool-input-delta event
   */
  emitToolInputDelta(toolCallId: string, inputTextDelta: string): void {
    this.emit({
      type: "tool-input-delta",
      toolCallId,
      inputTextDelta,
    });
  }

  /**
   * Emit a tool-input-available event
   */
  emitToolInputAvailable(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    dynamic?: boolean,
  ): void {
    this.emit({
      type: "tool-input-available",
      toolCallId,
      toolName,
      input,
      ...(dynamic && { dynamic: true }),
    });
  }

  /**
   * Emit a tool-output-available event
   */
  emitToolOutputAvailable(toolCallId: string, output: unknown, dynamic?: boolean): void {
    this.emit({
      type: "tool-output-available",
      toolCallId,
      output,
      ...(dynamic && { dynamic: true }),
    });
  }

  /**
   * Emit a tool-output-error event
   */
  emitToolOutputError(toolCallId: string, errorText: string, dynamic?: boolean): void {
    this.emit({
      type: "tool-output-error",
      toolCallId,
      errorText,
      ...(dynamic && { dynamic: true }),
    });
  }

  /**
   * Emit a tool-input-error event
   */
  emitToolInputError(toolCallId: string, errorText: string, dynamic?: boolean): void {
    this.emit({
      type: "tool-input-error",
      toolCallId,
      errorText,
      ...(dynamic && { dynamic: true }),
    });
  }

  /**
   * Emit a finish event
   */
  emitFinish(): void {
    this.emit({ type: "finish" });
  }

  /**
   * Emit an error event
   */
  emitError(error: string): void {
    this.emit({ type: "error", error });
  }

  /**
   * Emit a step event (Veryfront extension)
   */
  emitStartStep(): void {
    this.emit({ type: "start-step" });
  }

  /**
   * Emit a finish-step event (Veryfront extension)
   */
  emitFinishStep(): void {
    this.emit({ type: "finish-step" });
  }
}
