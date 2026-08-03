import type { HostToolTraceAttributes } from "#veryfront/tool";
import {
  type ForkRuntimeStreamResult,
  startAgentRuntimeForkWithHostTools,
  type StartAgentRuntimeForkWithHostToolsInput,
} from "../streaming/fork-runtime-stream.ts";
import {
  type HostedChildRunIdentifiers,
  monitorHostedChildRunStatus,
  type MonitorHostedChildRunStatusInput,
} from "./child-status.ts";
import { composeAbortSignals } from "./child-stream-watchdog.ts";

/** Public API contract for hosted child run status monitor. */
export type HostedChildRunStatusMonitor = (
  input: MonitorHostedChildRunStatusInput,
) => Promise<void>;

/** Input payload for start hosted child fork runtime with host tools. */
export type StartHostedChildForkRuntimeWithHostToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = StartAgentRuntimeForkWithHostToolsInput<TAttributes> & {
  durableChildRun?: HostedChildRunIdentifiers;
  childRunMonitorPollIntervalMs?: number;
  monitorChildRunStatus?: HostedChildRunStatusMonitor;
};

/** Public API contract for started hosted child fork runtime. */
export interface StartedHostedChildForkRuntime {
  forkStreamAbortController: AbortController;
  childRunMonitorAbortController: AbortController | null;
  childRunMonitorPromise: Promise<void>;
  streamResult: ForkRuntimeStreamResult;
  forkToolNames: string[];
}

/** Starts hosted child fork runtime with host tools. */
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
  const abortForkStream = (error: Error) => {
    if (!forkStreamAbortController.signal.aborted) {
      forkStreamAbortController.abort(error);
    }
  };
  const childRunMonitorPromise = durableChildRun
    ? monitor({
      authToken: runtimeInput.authToken,
      apiUrl: runtimeInput.apiUrl,
      identifiers: durableChildRun,
      abortSignal: childRunMonitorSignal,
      pollIntervalMs: childRunMonitorPollIntervalMs ?? 2_000,
      onTerminal: abortForkStream,
      onMonitoringExhausted: abortForkStream,
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
