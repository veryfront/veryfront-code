import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Shared tool input pending threshold ms value. */
export const TOOL_INPUT_PENDING_THRESHOLD_MS = 5_000;
const MAX_TRACKED_TOOL_CALLS = 128;
const MAX_TOOL_CALL_ID_CHARACTERS = 1_024;

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

  let toolCallId: unknown;
  let id: unknown;
  try {
    const record = part as Record<string, unknown>;
    toolCallId = record.toolCallId;
    id = record.id;
  } catch {
    return null;
  }

  for (const candidate of [toolCallId, id]) {
    if (
      typeof candidate === "string" && candidate.length > 0 &&
      candidate.length <= MAX_TOOL_CALL_ID_CHARACTERS &&
      !hasUnsafeControlCharacters(candidate)
    ) {
      return candidate;
    }
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
    if (events.length >= MAX_TRACKED_TOOL_CALLS) break;
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
  if (!Number.isSafeInteger(thresholdMs) || thresholdMs < 1 || thresholdMs > 60_000) {
    throw new RangeError("Tool input status threshold must be an integer from 1 to 60000 ms");
  }
  const iterator = stream[Symbol.asyncIterator]();
  const toolStates = new Map<string, ToolInputStatusState>();
  const buffered: unknown[] = [];
  let nextPartPromise: Promise<IteratorResult<unknown>> | null = null;
  let iteratorDone = false;

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

    let state = toolStates.get(toolCallId);
    if (!state) {
      if (toolStates.size >= MAX_TRACKED_TOOL_CALLS) return;
      state = { dueAt: null, lastStatus: null };
    }
    state.dueAt = Date.now() + thresholdMs;
    toolStates.set(toolCallId, state);
  };

  const markStreaming = (toolCallId: string | null) => {
    if (!toolCallId) {
      return;
    }

    let state = toolStates.get(toolCallId);
    if (!state) {
      if (toolStates.size >= MAX_TRACKED_TOOL_CALLS) return;
      state = { dueAt: null, lastStatus: null };
    }

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

    let partType: string | null = null;
    try {
      const type = (part as Record<string, unknown>).type;
      partType = typeof type === "string" ? type : null;
    } catch {
      buffered.push(part);
      return;
    }
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

  try {
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
        // Clear the timer in finally so it is released even when the race
        // rejects (iterator error) or the generator is abandoned mid-await
        // (consumer break/return), not just on the happy path.
        let timeoutResult:
          | { kind: "part"; result: IteratorResult<unknown> }
          | { kind: "timeout" };
        try {
          timeoutResult = await Promise.race([
            nextPartPromise.then((result) => ({ kind: "part" as const, result })),
            new Promise<{ kind: "timeout" }>((resolve) => {
              timeoutId = setTimeout(
                () => resolve({ kind: "timeout" }),
                Math.max(0, nextDueAt - Date.now()),
              );
            }),
          ]);
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
        }

        if (timeoutResult.kind === "timeout") {
          const readyResult = await readPartIfReady();
          if (readyResult) {
            if (readyResult.done) {
              iteratorDone = true;
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
          iteratorDone = true;
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
        iteratorDone = true;
        return;
      }

      processPart(result.value);
    }
  } finally {
    if (!iteratorDone && typeof iterator.return === "function") {
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        // Cleanup failures must not replace the stream error or cancellation reason.
      }
    }
  }
}
