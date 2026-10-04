import {
  isProviderReplayDelivered,
  readAttachedProviderMetadata,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import {
  COMPLETED_AGENT_STEP_STATE_KEY,
  MAX_COMPLETED_STEP_CHECKPOINT_BYTES,
} from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { observePrivatePromise } from "#veryfront/security/private-promise.ts";
import {
  appendPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  slicePrivateArray,
} from "#veryfront/security/private-array.ts";
import type { CompletedAgentStep } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { requireHostPrivateApiHttps } from "#veryfront/config/host-api-base.ts";
import { IntrinsicPromise } from "#veryfront/platform/compat/primordials/promise.ts";
import {
  addAbortSignalListenerOnce,
  isAbortSignalAborted,
  removeAbortSignalListener,
} from "#veryfront/platform/compat/abort-signal.ts";

const apply = Reflect.apply;
const NativeDate = Date;
const hostDateNow = Date.now;
const dateToISOString = Date.prototype.toISOString;
const NativeAbortSignal = AbortSignal;
const timeout = AbortSignal.timeout;
const anySignal = AbortSignal.any;
const responseJson = Response.prototype.json;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const ownProperty = Object.getOwnPropertyDescriptor;
const encode = encodeURIComponent;
const checkpointEncoder = new TextEncoder();
const encodeCheckpoint = TextEncoder.prototype.encode;
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new IntrinsicPromise((resolve) => {
    if (isAbortSignalAborted(signal)) {
      resolve();
      return;
    }
    const finish = () => {
      hostClearTimeout(timer);
      removeAbortSignalListener(signal, finish);
      resolve();
    };
    const timer = hostSetTimeout(finish, 1_000);
    addAbortSignalListenerOnce(signal, finish);
    if (isAbortSignalAborted(signal)) finish();
  });
}

/** The verified host binds both credentials before authored project code runs. */
export function createCompletedStepPauseAcknowledger(
  input: { apiUrl: string; runId: string; authToken: string; terminalToken: string },
  deps?: { transport: typeof fetch; sleep: (signal: AbortSignal) => Promise<void> },
): (
  checkpoint: Record<string, unknown> | (() => Record<string, unknown>),
  signal: AbortSignal,
) => Promise<boolean> {
  const apiUrl = requireHostPrivateApiHttps(input.apiUrl);
  const url = `${apiUrl}/runs/${encode(input.runId)}/pause-ack`;
  const transport = deps?.transport ?? createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  const sleep = deps?.sleep ?? waitForRetry;
  const headers = {
    Authorization: `Bearer ${input.authToken}`,
    "X-Veryfront-Run-Terminal-Token": input.terminalToken,
    "Content-Type": "application/json",
  };
  return async (checkpoint, signal) => {
    // One immutable payload is replayed after a lost response; it never reruns a tool.
    let body = "{}";
    let checkpointSent = false;
    while (!isAbortSignalAborted(signal)) {
      let buildCheckpoint = false;
      try {
        const response = await observePrivatePromise(transport(url, {
          method: "POST",
          redirect: "error",
          headers,
          body,
          signal: apply(anySignal, NativeAbortSignal, [[
            signal,
            apply(timeout, NativeAbortSignal, [10_000]),
          ]]),
        }));
        const status = apply(responseStatus, response, []) as number;
        if (status === 200) {
          const result: unknown = await observePrivatePromise(
            apply(responseJson, response, []) as Promise<unknown>,
          );
          const stop = result !== null && typeof result === "object"
            ? ownProperty(result, "stop")?.value
            : undefined;
          const required = result !== null && typeof result === "object"
            ? ownProperty(result, "checkpoint_required")?.value
            : undefined;
          if (stop === false && required === true) {
            if (!checkpointSent) {
              buildCheckpoint = true;
            }
          }
          if (typeof stop === "boolean" && required === undefined) return stop;
        }
        if (response.body) await observePrivatePromise(response.body.cancel());
      } catch {
        // An unreadable or rejected acknowledgement keeps this completed step held.
      }
      if (isAbortSignalAborted(signal)) return true;
      if (buildCheckpoint) {
        // An unretainable step fails explicitly; retrying cannot make it resumable.
        const serialized = privateJsonStringify(
          typeof checkpoint === "function" ? checkpoint() : checkpoint,
        );
        if (
          (apply(encodeCheckpoint, checkpointEncoder, [serialized]) as Uint8Array).byteLength >
            MAX_COMPLETED_STEP_CHECKPOINT_BYTES
        ) {
          throw new Error("Completed-step checkpoint exceeds the 512 KB resume limit");
        }
        body = `{"checkpoint":${serialized}}`;
        checkpointSent = true;
        continue;
      }
      if (!isAbortSignalAborted(signal)) await observePrivatePromise(sleep(signal));
    }
    return true;
  };
}

/** Retain only replay input and usage; the SDK context carries host credentials. */
export function buildCompletedStepPauseCheckpoint<
  TInput extends Pick<AgUiRuntimeRequest, "runId" | "context" | "forwardedProps">,
>(
  input: TInput,
  step: CompletedAgentStep,
  priorUsage: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  const providerReplayMetadata: {
    messageIndex: number;
    providerMetadata: Record<string, unknown>;
    replayDelivered: boolean;
  }[] = [];
  for (let messageIndex = 0; messageIndex < step.messages.length; messageIndex++) {
    const message = step.messages[messageIndex]!;
    const providerMetadata = readAttachedProviderMetadata(message);
    if (providerMetadata !== undefined) {
      pushPrivateArray(providerReplayMetadata, {
        messageIndex,
        providerMetadata,
        replayDelivered: isProviderReplayDelivered(message),
      });
    }
  }
  const preParkUsage = slicePrivateArray(priorUsage, 0);
  appendPrivateArray(
    preParkUsage,
    [
      step.usageMetadata ? { ...step.usageMetadata } : {
        provider: "unknown",
        model: "unknown",
        inputTokens: step.usage.promptTokens,
        outputTokens: step.usage.completionTokens,
        totalTokens: step.usage.totalTokens,
        finishReason: "manual_pause",
      },
    ],
  );
  return {
    kind: "agent_manual_pause",
    runId: input.runId,
    completedSteps: step.completedSteps,
    ...(step.toolExposureCheckpoint ? { toolExposureCheckpoint: step.toolExposureCheckpoint } : {}),
    replayMessages: mapPrivateArray(step.messages, (message, index) => ({
      ...message,
      ...(index === step.messages.length - 1
        ? {
          metadata: {
            ...message.metadata,
            [COMPLETED_AGENT_STEP_STATE_KEY]: {
              runId: input.runId,
              completedSteps: step.completedSteps,
              ...(providerReplayMetadata.length > 0 ? { providerReplayMetadata } : {}),
              ...(step.loopState ?? {
                agentWriteFinalResponseGuard: false,
                hasCompletedTool: false,
                recoveredEmptyResponse: false,
                recoveredInterruptedLocalToolBatch: false,
                hasSubmittedFormInput: false,
                runtimeGeneratedMessageIndexes: [],
              }),
            },
          },
        }
        : {}),
      id: typeof message.id === "string" && message.id.length > 0
        ? message.id
        : `${input.runId}:step:${step.completedSteps}:message:${index}`,
    })),
    context: input.context,
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
    preParkUsage,
    createdAt: apply(dateToISOString, new NativeDate(hostDateNow()), []),
  };
}
