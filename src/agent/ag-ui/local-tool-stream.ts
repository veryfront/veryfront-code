type ToolEvent = { type: string; toolCallId?: unknown };

/** Keep streamed tool input behind its execution-owned durable start. */
export function createLocalToolStream() {
  const admitted = new Set<string>();
  const pending = new Map<string, ToolEvent[]>();
  return {
    encode<T extends ToolEvent>(events: T[]): T[] {
      return events.filter((event) => {
        const id = event.toolCallId;
        if (typeof id !== "string" || !event.type.startsWith("TOOL_CALL_")) return true;
        if (admitted.has(id)) return event.type !== "TOOL_CALL_START";
        const buffered = pending.get(id) ?? [];
        if (
          event.type !== "TOOL_CALL_START" ||
          !buffered.some((pending) => pending.type === "TOOL_CALL_START")
        ) buffered.push(event);
        pending.set(id, buffered);
        return false;
      });
    },
    admit(id: string): ToolEvent[] {
      admitted.add(id);
      const events = pending.get(id) ?? [];
      pending.delete(id);
      return events.filter((event) => event.type !== "TOOL_CALL_START");
    },
    finish(): ToolEvent[] {
      const events = Array.from(pending.values()).flat();
      pending.clear();
      return events;
    },
  };
}
