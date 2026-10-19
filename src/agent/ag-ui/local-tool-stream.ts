import { pushPrivateArray, slicePrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { privateTextStartsWith } from "#veryfront/security/private-text.ts";

type ToolEvent = { type: string; toolCallId?: unknown };

/** Keep streamed events ordered behind execution-owned durable tool starts. */
export function createLocalToolStream() {
  const admitted = createPrivateSet<string>();
  const started = createPrivateSet<string>();
  let pending: ToolEvent[] = [];
  const toolId = (event: ToolEvent) =>
    privateTextStartsWith(event.type, "TOOL_CALL_") && typeof event.toolCallId === "string"
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
        pushPrivateArray(events, event);
      }
    }
    pending = slicePrivateArray(pending, consumed);
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
        pushPrivateArray(pending, event);
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
