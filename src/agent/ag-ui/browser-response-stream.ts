import type { AgentResponse } from "../types.ts";
import type { AgUiSseEvent } from "./host-support.ts";

const encoder = new TextEncoder();

function formatAgUiSseEventWithId(event: AgUiSseEvent, eventId: number | null): Uint8Array {
  const idLine = eventId === null ? "" : `id: ${eventId}\n`;
  return encoder.encode(
    `${idLine}event: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`,
  );
}

function invokeFailWithoutLeaking(
  fail: (error: unknown) => Promise<void>,
  error: unknown,
): Promise<void> {
  return fail(error).catch(() => undefined);
}

/** State for AG-UI browser response request. */
export interface AgUiBrowserResponseRequestState {
  runId?: string;
  threadId?: string;
  state?: unknown;
  messages: unknown[];
}

/** Public API contract for AG-UI browser response execution. */
export interface AgUiBrowserResponseExecution<TChunk> {
  agentUIStream: AsyncIterable<TChunk>;
  fail: (error: unknown) => Promise<void>;
  waitForFinish: () => Promise<void>;
}

/** Public API contract for AG-UI browser response encoder. */
export interface AgUiBrowserResponseEncoder<TChunk> {
  encode: (chunk: TChunk) => AgUiSseEvent[];
  finalize: (response: AgentResponse | null) => AgUiSseEvent[];
}

/** Input payload for create AG-UI browser response stream. */
export interface CreateAgUiBrowserResponseStreamInput<TChunk, TState> {
  agUiInput: AgUiBrowserResponseRequestState;
  agentId: string;
  execution: AgUiBrowserResponseExecution<TChunk>;
  encoder: AgUiBrowserResponseEncoder<TChunk>;
  initialState: TState;
  onChunk?: (state: TState, chunk: TChunk) => void;
  getFinalResponse?: (state: TState) => AgentResponse | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSnapshot(snapshot: unknown): Record<string, unknown> {
  return isRecord(snapshot) ? snapshot : {};
}

/** Create AG-UI browser response stream. */
export function createAgUiBrowserResponseStream<TChunk, TState>(
  input: CreateAgUiBrowserResponseStreamInput<TChunk, TState>,
): ReadableStream<Uint8Array> {
  let streamClosed = false;
  let nextEventId = 1;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: AgUiSseEvent) => {
        if (streamClosed) {
          return false;
        }

        try {
          controller.enqueue(formatAgUiSseEventWithId(event, nextEventId));
          nextEventId += 1;
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };

      const closeStream = () => {
        if (streamClosed) {
          return;
        }

        if (controller.desiredSize === null) {
          streamClosed = true;
          return;
        }

        controller.close();
        streamClosed = true;
      };

      void (async () => {
        const state = input.initialState;

        try {
          if (
            !writeEvent({
              event: "RunStarted",
              payload: {
                runId: input.agUiInput.runId,
                threadId: input.agUiInput.threadId,
                agentId: input.agentId,
              },
            })
          ) {
            return;
          }

          if (
            !writeEvent({
              event: "StateSnapshot",
              payload: {
                snapshot: normalizeSnapshot(input.agUiInput.state),
              },
            })
          ) {
            return;
          }

          if (
            !writeEvent({
              event: "MessagesSnapshot",
              payload: {
                messages: input.agUiInput.messages,
              },
            })
          ) {
            return;
          }

          for await (const chunk of input.execution.agentUIStream) {
            if (streamClosed) {
              return;
            }
            input.onChunk?.(state, chunk);
            for (const event of input.encoder.encode(chunk)) {
              if (!writeEvent(event)) {
                return;
              }
            }
          }

          if (streamClosed) {
            return;
          }
          await input.execution.waitForFinish();

          if (streamClosed) {
            return;
          }
          for (const event of input.encoder.finalize(input.getFinalResponse?.(state) ?? null)) {
            if (!writeEvent(event)) {
              return;
            }
          }
        } catch (error) {
          await invokeFailWithoutLeaking(input.execution.fail, error);
          writeEvent({
            event: "RunError",
            payload: {
              code: "STREAM_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        } finally {
          closeStream();
        }
      })();
    },
    cancel() {
      streamClosed = true;
    },
  });
}
