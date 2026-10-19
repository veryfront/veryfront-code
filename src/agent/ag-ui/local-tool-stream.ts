type ToolEvent = { type: string; toolCallId?: unknown };

/** Keep streamed events ordered behind execution-owned durable tool starts. */
export function createLocalToolStream() {
  const admitted = new Set<string>();
  const started = new Set<string>();
  const pending: ToolEvent[] = [];
  const toolId = (event: ToolEvent) =>
    event.type.startsWith("TOOL_CALL_") && typeof event.toolCallId === "string"
      ? event.toolCallId
      : undefined;
  const drain = (finishing = false): ToolEvent[] => {
    const events: ToolEvent[] = [];
    let consumed = 0;
    while (consumed < pending.length) {
      const event = pending[consumed]!;
      const id = toolId(event);
      if (!finishing && id !== undefined && !admitted.has(id)) break;
      consumed++;
      if (event.type !== "TOOL_CALL_START" || id === undefined || !admitted.has(id)) {
        events.push(event);
      }
    }
    pending.splice(0, consumed);
    return events;
  };
  return {
    encode(events: ToolEvent[]): ToolEvent[] {
      for (const event of events) {
        const id = toolId(event);
        if (event.type === "TOOL_CALL_START" && id !== undefined) {
          if (started.has(id) || admitted.has(id)) continue;
          started.add(id);
        }
        pending.push(event);
      }
      return drain();
    },
    admit(id: string): ToolEvent[] {
      admitted.add(id);
      return drain();
    },
    finish(): ToolEvent[] {
      return drain(true);
    },
  };
}
