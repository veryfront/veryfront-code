import { normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";

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

type ToolInputStatusLifecycle = {
  cancellation: Promise<void>;
  cancellationRequested: boolean;
  sourceDone: boolean;
};

type CloseSourceIterator = () => Promise<IteratorResult<unknown>> | null;

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
export function withToolInputStatusTransitions(
  stream: AsyncIterable<unknown>,
  thresholdMs = TOOL_INPUT_PENDING_THRESHOLD_MS,
): AsyncIterable<unknown> {
  const normalizedThresholdMs = normalizeTimerDurationMs(thresholdMs, "thresholdMs");
  if (normalizedThresholdMs === 0) {
    throw new RangeError("thresholdMs must be greater than zero");
  }
  const iterator = stream[Symbol.asyncIterator]();
  const returnSource = iterator.return?.bind(iterator);
  let resolveCancellation!: () => void;
  const lifecycle: ToolInputStatusLifecycle = {
    cancellation: new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    }),
    cancellationRequested: false,
    sourceDone: false,
  };
  let sourceClosePromise: Promise<IteratorResult<unknown>> | null = null;

  const closeSource: CloseSourceIterator = () => {
    if (lifecycle.sourceDone || !returnSource) {
      return null;
    }
    if (!sourceClosePromise) {
      try {
        sourceClosePromise = Promise.resolve(returnSource());
      } catch (error) {
        sourceClosePromise = Promise.reject(error);
      }
      // A pending source read must not make consumer cancellation wait for
      // upstream cleanup. Keep the rejection observed until it can be awaited.
      void sourceClosePromise.catch(() => {});
    }
    return sourceClosePromise;
  };

  const requestCancellation = (): void => {
    if (!lifecycle.cancellationRequested) {
      lifecycle.cancellationRequested = true;
      // Iterator cleanup is provider-controlled and may never settle even
      // when no source read is currently pending. Trigger and observe it, but
      // never let consumer cancellation wait on that cleanup promise.
      resolveCancellation();
    }
    closeSource();
  };

  const transformed = applyToolInputStatusTransitions(
    iterator,
    normalizedThresholdMs,
    lifecycle,
    closeSource,
  );

  const wrapped: AsyncIterableIterator<unknown> = {
    next() {
      return transformed.next();
    },
    async return(value?: unknown) {
      requestCancellation();
      return await transformed.return(value);
    },
    async throw(error?: unknown) {
      requestCancellation();
      return await transformed.throw(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return wrapped;
}

async function* applyToolInputStatusTransitions(
  iterator: AsyncIterator<unknown>,
  thresholdMs: number,
  lifecycle: ToolInputStatusLifecycle,
  closeSource: CloseSourceIterator,
): AsyncGenerator<unknown, unknown, unknown> {
  const toolStates = new Map<string, ToolInputStatusState>();
  const buffered: unknown[] = [];
  let nextPartPromise: Promise<IteratorResult<unknown>> | null = null;

  const readNextPart = (): Promise<IteratorResult<unknown>> => {
    try {
      return Promise.resolve(iterator.next());
    } catch (error) {
      return Promise.reject(error);
    }
  };

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

  try {
    while (true) {
      if (lifecycle.cancellationRequested) {
        return;
      }

      if (buffered.length > 0) {
        yield buffered.shift();
        continue;
      }

      if (!nextPartPromise) {
        nextPartPromise = readNextPart();
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
          | { kind: "timeout" }
          | { kind: "canceled" };
        try {
          timeoutResult = await Promise.race([
            nextPartPromise.then((result) => ({ kind: "part" as const, result })),
            new Promise<{ kind: "timeout" }>((resolve) => {
              timeoutId = setTimeout(
                () => resolve({ kind: "timeout" }),
                Math.min(thresholdMs, Math.max(0, nextDueAt - Date.now())),
              );
            }),
            lifecycle.cancellation.then(() => ({ kind: "canceled" as const })),
          ]);
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
        }

        if (timeoutResult.kind === "canceled") {
          return;
        }

        if (timeoutResult.kind === "timeout") {
          const readyResult = await readPartIfReady();
          if (readyResult) {
            if (readyResult.done) {
              lifecycle.sourceDone = true;
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
          lifecycle.sourceDone = true;
          buffered.push(...collectDueToolStatuses(toolStates, Date.now(), thresholdMs));
          while (buffered.length > 0) {
            yield buffered.shift();
          }
          return;
        }

        processPart(timeoutResult.result.value);
        continue;
      }

      const nextResult = await Promise.race([
        nextPartPromise.then((result) => ({ kind: "part" as const, result })),
        lifecycle.cancellation.then(() => ({ kind: "canceled" as const })),
      ]);
      if (nextResult.kind === "canceled") {
        return;
      }

      nextPartPromise = null;
      if (nextResult.result.done) {
        lifecycle.sourceDone = true;
        return;
      }

      processPart(nextResult.result.value);
    }
  } finally {
    if (!lifecycle.sourceDone) {
      closeSource();
    }
  }
}
