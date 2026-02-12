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
    this.emit(
      dynamic ? { type, toolCallId, ...extra, dynamic: true } : { type, toolCallId, ...extra },
    );
  }

  emitStart(messageId: string): void {
    this.emit({ type: "message-start", messageId });
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
    this.emit({ type: "message-finish" });
  }

  emitError(error: string): void {
    this.emit({ type: "error", error });
  }

  emitStepStart(): void {
    this.emit({ type: "step-start" });
  }

  emitStepEnd(): void {
    this.emit({ type: "step-end" });
  }
}
