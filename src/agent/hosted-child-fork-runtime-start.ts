import type { HostToolTraceAttributes } from "#veryfront/tool";
import {
  type ForkRuntimeStreamResult,
  startAgentRuntimeForkWithHostTools,
  type StartAgentRuntimeForkWithHostToolsInput,
} from "./fork-runtime-stream.ts";
import {
  type HostedChildRunIdentifiers,
  monitorHostedChildRunStatus,
  type MonitorHostedChildRunStatusInput,
} from "./hosted-child-status.ts";
import { composeAbortSignals } from "./hosted-child-stream-watchdog.ts";

export type HostedChildRunStatusMonitor = (
  input: MonitorHostedChildRunStatusInput,
) => Promise<void>;

export type StartHostedChildForkRuntimeWithHostToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = StartAgentRuntimeForkWithHostToolsInput<TAttributes> & {
  durableChildRun?: HostedChildRunIdentifiers;
  childRunMonitorPollIntervalMs?: number;
  monitorChildRunStatus?: HostedChildRunStatusMonitor;
};

export interface StartedHostedChildForkRuntime {
  forkStreamAbortController: AbortController;
  childRunMonitorAbortController: AbortController | null;
  childRunMonitorPromise: Promise<void>;
  streamResult: ForkRuntimeStreamResult;
  forkToolNames: string[];
}

export function startHostedChildForkRuntimeWithHostTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: StartHostedChildForkRuntimeWithHostToolsInput<TAttributes>,
): StartedHostedChildForkRuntime {
  const {
    durableChildRun,
    childRunMonitorPollIntervalMs,
    monitorChildRunStatus,
    abortSignal,
    ...runtimeInput
  } = input;
  const forkStreamAbortController = new AbortController();
  const forkStreamAbortSignal = composeAbortSignals([
    abortSignal,
    forkStreamAbortController.signal,
  ]);

  const childRunMonitorAbortController = durableChildRun ? new AbortController() : null;
  const childRunMonitorSignal = childRunMonitorAbortController
    ? composeAbortSignals([abortSignal, childRunMonitorAbortController.signal])
    : undefined;
  const monitor = monitorChildRunStatus ?? monitorHostedChildRunStatus;
  const childRunMonitorPromise = durableChildRun
    ? monitor({
      authToken: runtimeInput.authToken,
      apiUrl: runtimeInput.apiUrl,
      identifiers: durableChildRun,
      abortSignal: childRunMonitorSignal,
      pollIntervalMs: childRunMonitorPollIntervalMs ?? 2_000,
      onTerminal: (error) => {
        if (!forkStreamAbortController.signal.aborted) {
          forkStreamAbortController.abort(error);
        }
      },
    })
    : Promise.resolve();

  const { streamResult, forkToolNames } = startAgentRuntimeForkWithHostTools({
    ...runtimeInput,
    abortSignal: forkStreamAbortSignal,
  });

  return {
    forkStreamAbortController,
    childRunMonitorAbortController,
    childRunMonitorPromise,
    streamResult,
    forkToolNames,
  };
}
