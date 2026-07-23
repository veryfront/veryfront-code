import { type HostedLifecycleExecution, runHostedLifecycle } from "./lifecycle.ts";

/** Public API contract for hosted response stream writer. */
export interface HostedResponseStreamWriter<TChunk> {
  /** Callback that handles write. */
  write: (chunk: TChunk) => void;
}

/** State for hosted response stream heartbeat. */
export interface HostedResponseStreamHeartbeatState {
  /** Heartbeat count value. */
  heartbeatCount: number;
  /** Elapsed seconds value. */
  elapsedSeconds: number;
}

/** Public API contract for hosted response stream heartbeat. */
export interface HostedResponseStreamHeartbeat<TChunk> {
  /** Interval ms value. */
  intervalMs?: number;
  /** Callback that handles build chunk. */
  buildChunk: () => TChunk;
  /** Callback invoked when beat. */
  onBeat?: (state: HostedResponseStreamHeartbeatState) => void;
  /** Callback invoked when stop. */
  onStop?: (state: HostedResponseStreamHeartbeatState) => void;
}

/** Options for streaming hosted lifecycle output with keepalive chunks. */
export interface RunHostedResponseStreamWithHeartbeatOptions<TChunk> {
  /** Hosted lifecycle execution to consume. */
  execution: HostedLifecycleExecution<TChunk>;
  /** Destination for output and heartbeat chunks. */
  writer: HostedResponseStreamWriter<TChunk>;
  /** Optional heartbeat configuration. */
  heartbeat?: HostedResponseStreamHeartbeat<TChunk>;
  /** Optional run identifier included in diagnostics. */
  runId?: string;
  /** Optional abort signal for external cancellation of the hosted lifecycle. */
  abortSignal?: AbortSignal;
}

function getHeartbeatState(
  startedAt: number,
  heartbeatCount: number,
): HostedResponseStreamHeartbeatState {
  return {
    heartbeatCount,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

function startHostedResponseStreamHeartbeat<TChunk>(input: {
  writer: HostedResponseStreamWriter<TChunk>;
  heartbeat: HostedResponseStreamHeartbeat<TChunk>;
}): { stop: () => void } {
  const startedAt = Date.now();
  let heartbeatCount = 0;
  const interval = setInterval(() => {
    heartbeatCount += 1;
    input.heartbeat.onBeat?.(getHeartbeatState(startedAt, heartbeatCount));

    try {
      input.writer.write(input.heartbeat.buildChunk());
    } catch {
      clearInterval(interval);
    }
  }, input.heartbeat.intervalMs ?? 15_000);

  return {
    stop: () => {
      clearInterval(interval);
      input.heartbeat.onStop?.(getHeartbeatState(startedAt, heartbeatCount));
    },
  };
}

/** Run hosted response stream with heartbeat. */
export async function runHostedResponseStreamWithHeartbeat<TChunk>(
  options: RunHostedResponseStreamWithHeartbeatOptions<TChunk>,
): Promise<void> {
  const heartbeat = options.heartbeat
    ? startHostedResponseStreamHeartbeat({
      writer: options.writer,
      heartbeat: options.heartbeat,
    })
    : null;

  try {
    await runHostedLifecycle({
      abortSignal: options.abortSignal ?? new AbortController().signal,
      execution: options.execution,
      adapter: {
        startRun: () => ({ runId: options.runId ?? "response-stream" }),
        appendEvents: (_run, chunk) => {
          options.writer.write(chunk);
        },
      },
      resolveTerminalState: () => ({ status: "completed" }),
    });
  } finally {
    heartbeat?.stop();
  }
}
