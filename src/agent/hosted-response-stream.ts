import { type HostedLifecycleExecution, runHostedLifecycle } from "./hosted-lifecycle.ts";

export interface HostedResponseStreamWriter<TChunk> {
  write: (chunk: TChunk) => void;
}

export interface HostedResponseStreamHeartbeatState {
  heartbeatCount: number;
  elapsedSeconds: number;
}

export interface HostedResponseStreamHeartbeat<TChunk> {
  intervalMs?: number;
  buildChunk: () => TChunk;
  onBeat?: (state: HostedResponseStreamHeartbeatState) => void;
  onStop?: (state: HostedResponseStreamHeartbeatState) => void;
}

export interface RunHostedResponseStreamWithHeartbeatOptions<TChunk> {
  execution: HostedLifecycleExecution<TChunk>;
  writer: HostedResponseStreamWriter<TChunk>;
  heartbeat?: HostedResponseStreamHeartbeat<TChunk>;
  runId?: string;
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
      abortSignal: new AbortController().signal,
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
