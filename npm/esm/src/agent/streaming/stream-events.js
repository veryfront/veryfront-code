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
export class StreamEventEmitter {
    controller;
    encoder = new TextEncoder();
    constructor(controller) {
        this.controller = controller;
    }
    emit(event) {
        this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    }
    emitToolEvent(type, toolCallId, extra, dynamic) {
        const event = { type, toolCallId, ...extra };
        if (dynamic)
            event.dynamic = true;
        this.emit(event);
    }
    emitStart(messageId) {
        this.emit({ type: "start", messageId });
    }
    emitTextStart(id) {
        this.emit({ type: "text-start", id });
    }
    emitTextDelta(id, delta) {
        this.emit({ type: "text-delta", id, delta });
    }
    emitTextEnd(id) {
        this.emit({ type: "text-end", id });
    }
    emitToolInputStart(toolCallId, toolName, dynamic) {
        this.emitToolEvent("tool-input-start", toolCallId, { toolName }, dynamic);
    }
    emitToolInputDelta(toolCallId, inputTextDelta) {
        this.emit({ type: "tool-input-delta", toolCallId, inputTextDelta });
    }
    emitToolInputAvailable(toolCallId, toolName, input, dynamic) {
        this.emitToolEvent("tool-input-available", toolCallId, { toolName, input }, dynamic);
    }
    emitToolOutputAvailable(toolCallId, output, dynamic) {
        this.emitToolEvent("tool-output-available", toolCallId, { output }, dynamic);
    }
    emitToolOutputError(toolCallId, errorText, dynamic) {
        this.emitToolEvent("tool-output-error", toolCallId, { errorText }, dynamic);
    }
    emitToolInputError(toolCallId, errorText, dynamic) {
        this.emitToolEvent("tool-input-error", toolCallId, { errorText }, dynamic);
    }
    emitFinish() {
        this.emit({ type: "finish" });
    }
    emitError(error) {
        this.emit({ type: "error", error });
    }
    emitStartStep() {
        this.emit({ type: "start-step" });
    }
    emitFinishStep() {
        this.emit({ type: "finish-step" });
    }
}
