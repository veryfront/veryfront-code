/** Shared tool input pending threshold ms value. */
export const TOOL_INPUT_PENDING_THRESHOLD_MS = 5_000;

type ToolInputActivityStatus = "pending_input" | "streaming_input";

type ToolInputStatusState = {
  dueAt: number | null;
  lastStatus: ToolInputActivityStatus | null;
};

type ToolStatusEvent = {
  type: "data-tool-call-status";
  data: { toolCallId: string; status: "pending_input" | "streaming_input" };
};

export function getToolCallIdFromStreamPart(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;
  if (typeof record.toolCallId === "string" && record.toolCallId.length > 0) {
    return record.toolCallId;
  }

  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }

  return null;
}

export function collectDueToolStatuses(
  toolStates: Map<string, ToolInputStatusState>,
  now: number,
  thresholdMs: number,
): Array<{ type: "data-tool-call-status"; data: { toolCallId: string; status: "pending_input" } }> {
  const events: Array<
    { type: "data-tool-call-status"; data: { toolCallId: string; status: "pending_input" } }
  > = [];

  for (const [toolCallId, state] of toolStates.entries()) {
    if (state.dueAt === null || state.dueAt > now) {
      continue;
    }

    state.dueAt = now + thresholdMs;
    state.lastStatus = "pending_input";
    events.push({
      type: "data-tool-call-status",
      data: {
        toolCallId,
        status: "pending_input",
      },
    });
  }

  return events;
}

/** Applies tool input status transitions. */
export async function* withToolInputStatusTransitions(
  stream: AsyncIterable<unknown>,
  thresholdMs = TOOL_INPUT_PENDING_THRESHOLD_MS,
): AsyncIterable<unknown> {
  const iterator = stream[Symbol.asyncIterator]();
  const toolStates = new Map<string, ToolInputStatusState>();
  const buffered: unknown[] = [];
  let nextPartPromise: Promise<IteratorResult<unknown>> | null = null;

  const readPartIfReady = async (): Promise<IteratorResult<unknown> | null> => {
    if (!nextPartPromise) {
      return null;
    }

    const ready = await Promise.race([
      nextPartPromise.then((result) => ({ kind: "part" as const, result })),
      Promise.resolve({ kind: "pending" as const }),
    ]);

    if (ready.kind === "pending") {
      return null;
    }

    nextPartPromise = null;
    return ready.result;
  };

  const closeTool = (toolCallId: string | null) => {
    if (!toolCallId) {
      return;
    }

    toolStates.delete(toolCallId);
  };

  const schedulePending = (toolCallId: string | null) => {
    if (!toolCallId) {
      return;
    }

    const state = toolStates.get(toolCallId) ?? {
      dueAt: null,
      lastStatus: null,
    };
    state.dueAt = Date.now() + thresholdMs;
    toolStates.set(toolCallId, state);
  };

  const markStreaming = (toolCallId: string | null) => {
    if (!toolCallId) {
      return;
    }

    const state = toolStates.get(toolCallId) ?? {
      dueAt: null,
      lastStatus: null,
    };

    if (state.lastStatus !== "streaming_input") {
      buffered.push(
        {
          type: "data-tool-call-status",
          data: {
            toolCallId,
            status: "streaming_input",
          },
        } satisfies ToolStatusEvent,
      );
    }

    state.lastStatus = "streaming_input";
    state.dueAt = Date.now() + thresholdMs;
    toolStates.set(toolCallId, state);
  };

  const processPart = (part: unknown) => {
    if (!part || typeof part !== "object") {
      buffered.push(part);
      return;
    }

    const record = part as Record<string, unknown>;
    const partType = typeof record.type === "string" ? record.type : null;
    const toolCallId = getToolCallIdFromStreamPart(part);

    switch (partType) {
      case "tool-input-start":
        schedulePending(toolCallId);
        buffered.push(part);
        return;
      case "tool-input-delta":
        markStreaming(toolCallId);
        buffered.push(part);
        return;
      case "tool-call":
      case "tool-result":
      case "tool-error":
        closeTool(toolCallId);
        buffered.push(part);
        return;
      case "finish":
      case "error":
        toolStates.clear();
        buffered.push(part);
        return;
      default:
        buffered.push(part);
        return;
    }
  };

  while (true) {
    if (buffered.length > 0) {
      yield buffered.shift();
      continue;
    }

    if (!nextPartPromise) {
      nextPartPromise = iterator.next();
    }

    const nextDueAt = [...toolStates.values()]
      .map((state) => state.dueAt)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;

    if (nextDueAt !== null) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutResult = await Promise.race([
        nextPartPromise.then((result) => ({ kind: "part" as const, result })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          timeoutId = setTimeout(
            () => resolve({ kind: "timeout" }),
            Math.max(0, nextDueAt - Date.now()),
          );
        }),
      ]);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      if (timeoutResult.kind === "timeout") {
        const readyResult = await readPartIfReady();
        if (readyResult) {
          if (readyResult.done) {
            buffered.push(...collectDueToolStatuses(toolStates, Date.now(), thresholdMs));
            while (buffered.length > 0) {
              yield buffered.shift();
            }
            return;
          }

          processPart(readyResult.value);
          continue;
        }

        buffered.push(...collectDueToolStatuses(toolStates, Date.now(), thresholdMs));
        continue;
      }

      nextPartPromise = null;
      if (timeoutResult.result.done) {
        buffered.push(...collectDueToolStatuses(toolStates, Date.now(), thresholdMs));
        while (buffered.length > 0) {
          yield buffered.shift();
        }
        return;
      }

      processPart(timeoutResult.result.value);
      continue;
    }

    const result = await nextPartPromise;
    nextPartPromise = null;
    if (result.done) {
      return;
    }

    processPart(result.value);
  }
}
