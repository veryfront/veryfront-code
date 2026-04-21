import {
  runHostedLifecycle,
  type HostedLifecycleAdapter,
  type HostedLifecycleTerminalState,
} from "veryfront/agent";

type DurableChunk = { type: string; payload: unknown };
type DurableRunContext = {
  runId: string;
  latestCursor: number;
};

const adapter: HostedLifecycleAdapter<DurableRunContext, DurableChunk> = {
  startRun: async () => ({ runId: "run_123", latestCursor: 0 }),
  appendEvents: async (_run, _chunk) => {
    // Host-owned durable mirror append/retry policy.
  },
  finalizeRun: async (_run, _terminalState: HostedLifecycleTerminalState) => {
    // Host-owned complete/finalize call against the control plane.
  },
  cancelRun: async (_run, _terminalState: HostedLifecycleTerminalState) => {
    // Host-owned cancel call against the control plane.
  },
};

await runHostedLifecycle({
  abortSignal: new AbortController().signal,
  execution: {
    stream: {
      async *[Symbol.asyncIterator]() {
        yield { type: "text-delta", payload: "hello" } satisfies DurableChunk;
      },
    },
    waitForFinish: async () => {},
  },
  adapter,
  resolveTerminalState: () => ({ status: "completed" }),
});
