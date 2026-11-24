import type { AgentResponse } from "../types.ts";
import type { AgUiSseEvent } from "./host-support.ts";
import { type AgUiEncoderState, createAgUiEncoderState, stampAgUiEventTiming } from "./encoder.ts";

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

/** State for AG-UI response request. */
export interface AgUiResponseRequestState {
  runId?: string;
  threadId?: string;
  state?: unknown;
  messages: unknown[];
}

/** Public API contract for AG-UI response execution. */
export interface AgUiResponseExecution<TChunk> {
  agentUIStream: AsyncIterable<TChunk>;
  fail: (error: unknown) => Promise<void>;
  waitForFinish: () => Promise<void>;
  /** Trusted host projection; never return private diagnostics here. */
  formatError?: (error: unknown) => { code: string; message: string };
}

/** Public API contract for AG-UI response encoder. */
export interface AgUiResponseEncoder<TChunk> {
  encode: (chunk: TChunk) => AgUiSseEvent[];
  finalize: (response: AgentResponse | null) => AgUiSseEvent[];
  /** Shared timing anchor for bootstrap, chunk, and final events. */
  timingState?: AgUiEncoderState;
}

/** Input payload for create AG-UI response stream. */
export interface CreateAgUiResponseStreamInput<TChunk, TState> {
  agUiInput: AgUiResponseRequestState;
  agentId: string;
  /** True only for a trusted resumed invocation, not client state. */
  resumed?: boolean;
  execution: AgUiResponseExecution<TChunk>;
  encoder: AgUiResponseEncoder<TChunk>;
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

/** Create AG-UI response stream. */
export function createAgUiResponseStream<TChunk, TState>(
  input: CreateAgUiResponseStreamInput<TChunk, TState>,
): ReadableStream<Uint8Array> {
  let streamClosed = false;
  let nextEventId = 1;
  let terminalWritten = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const timingState = input.encoder.timingState ?? createAgUiEncoderState();
      const writeEvent = (event: AgUiSseEvent) => {
        if (streamClosed) {
          return false;
        }

        const terminal = event.event === "RunError" || event.event === "RunFinished";
        // Keep draining execution and cleanup after the first terminal event.
        if (terminal && terminalWritten) return true;

        try {
          const [timed] = stampAgUiEventTiming(timingState, [event]);
          controller.enqueue(formatAgUiSseEventWithId(timed ?? event, nextEventId));
          if (terminal) terminalWritten = true;
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
                ...(input.resumed ? { metadata: { resumed: true } } : {}),
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
          let failure = {
            code: "STREAM_ERROR",
            message: error instanceof Error ? error.message : String(error),
          };
          try {
            const format = input.execution.formatError;
            if (format) {
              const projected = format(error);
              failure = typeof projected?.code === "string" && typeof projected.message === "string"
                ? projected
                : { code: "STREAM_ERROR", message: "Stream failed" };
            }
          } catch {
            failure = { code: "STREAM_ERROR", message: "Stream failed" };
          }
          writeEvent({ event: "RunError", payload: failure });
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
