import { buildRuntimeAgentControlPlaneStreamRequestFromInvocation } from "../runtime/agent-invocation-contract.ts";
import { buildCompletedStepPauseCheckpoint } from "./completed-step-pause.ts";
import { observePrivatePromise } from "#veryfront/security/private-promise.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { mapPrivateArray } from "#veryfront/security/private-array.ts";
import { getMessageSchema } from "../schemas/agent.schema.ts";
import {
  restoreCompletedAgentStepReplay,
  stripCompletedStepMarkers,
} from "../runtime/completed-step-replay.ts";
import type { RuntimeAgentRunInvocation } from "../runtime/agent-invocation-contract.ts";
import type {
  CompletedAgentStepLoopState,
  RuntimeToolFilterConfig,
} from "../runtime/runtime-tool-config.ts";
import type { Message } from "../types.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import {
  createHostedCompletedStepAcknowledger,
  hasHostedTerminalCredential,
} from "./terminal-credential.ts";

const runs = createPrivateWeakStore<ParsedHostedChatRequest, {
  invocation: RuntimeAgentRunInvocation;
  replayMessages?: Message[];
  loopState?: CompletedAgentStepLoopState;
}>();

/** Bind only the verified canonical invocation; legacy chat bodies remain untrusted. */
export function registerHostedCompletedStepRun(
  request: ParsedHostedChatRequest,
  invocation: RuntimeAgentRunInvocation,
): boolean {
  if (
    request.serverEnvelopeVerified !== true || !hasHostedTerminalCredential(request) ||
    !invocation.credentials?.authToken || request.durableRootRun?.runId !== invocation.run.runId ||
    request.projectId !== invocation.run.project.projectId
  ) return false;
  const completedSteps = invocation.completedAgentSteps ?? 0;
  const replayMessages = completedSteps > 0
    ? mapPrivateArray(invocation.messages, (message) => getMessageSchema().parse(message))
    : undefined;
  // Scrub visible copies before validating the private replay binding.
  stripCompletedStepMarkers(request.messages);
  const loopState = replayMessages
    ? restoreCompletedAgentStepReplay(replayMessages, invocation.run.runId, completedSteps)
    : undefined;
  stripCompletedStepMarkers(invocation.messages);
  runs.set(request, { invocation, replayMessages, loopState });
  return true;
}

export function getHostedCompletedStepReplay(
  request: ParsedHostedChatRequest,
): Message[] | undefined {
  return runs.get(request)?.replayMessages;
}

/** SDK-owned options only; the stored invocation and credentials never leave this module. */
export function getHostedCompletedStepRuntimeState(request: ParsedHostedChatRequest):
  | Pick<
    RuntimeToolFilterConfig,
    "__vfCompletedSteps" | "__vfCompletedStepState" | "__vfToolExposureCheckpoint"
  >
  | undefined {
  const run = runs.get(request);
  if (!run) return undefined;
  return {
    __vfCompletedSteps: run.invocation.completedAgentSteps ?? 0,
    __vfCompletedStepState: run.loopState,
    ...(run.invocation.serverResolvedToolExposureCheckpoint !== undefined
      ? { __vfToolExposureCheckpoint: run.invocation.serverResolvedToolExposureCheckpoint }
      : {}),
  };
}

/** Transport-owned execution state, independent of authored agent configuration. */
export type HostedCompletedStepExecution = {
  config: Pick<
    RuntimeToolFilterConfig,
    | "__vfCompletedSteps"
    | "__vfCompletedStepState"
    | "__vfToolExposureCheckpoint"
    | "__vfCompletedStepBoundary"
  >;
  replayMessages?: Message[];
  isStopped: () => boolean;
  bindAbortSignal: (signal: AbortSignal) => void;
};

export function createHostedCompletedStepExecution(
  request: ParsedHostedChatRequest,
  apiUrl: string,
): HostedCompletedStepExecution | undefined {
  const run = runs.get(request);
  if (!run) return undefined;
  const acknowledge = createHostedCompletedStepAcknowledger(
    request,
    apiUrl,
    run.invocation.credentials!.authToken!,
  );
  if (!acknowledge) return undefined;
  const input = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(run.invocation);
  let stopped = false;
  let signal: AbortSignal | undefined;
  return {
    config: {
      ...getHostedCompletedStepRuntimeState(request),
      __vfCompletedStepBoundary: async (step) => {
        if (!signal) throw new Error("Hosted completed-step stream has not started");
        stopped = await observePrivatePromise(acknowledge(
          () =>
            buildCompletedStepPauseCheckpoint(
              input,
              step,
              run.invocation.serverResolvedPreParkUsage,
            ),
          signal,
        ));
        return stopped;
      },
    },
    replayMessages: run.replayMessages,
    isStopped: () => stopped,
    bindAbortSignal: (value) => {
      signal = value;
    },
  };
}
