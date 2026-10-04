import type { Message } from "../types.ts";
import { attachProviderMetadata, markProviderReplayDelivered } from "./provider-metadata.ts";
import { markRuntimeGeneratedUserMessage } from "./runtime-message-origin.ts";
import { extractSkillDelegationOverrides } from "./skill-delegation-overrides.ts";
import {
  COMPLETED_AGENT_STEP_STATE_KEY,
  type CompletedAgentStepLoopState,
} from "./runtime-tool-config.ts";
import { filterPrivateArray } from "#veryfront/security/private-array.ts";

const ownProperty = Object.getOwnPropertyDescriptor;
const deleteOwnProperty = Reflect.deleteProperty;
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;

export function stripCompletedStepMarkers(collection: readonly unknown[]): void {
  for (let index = 0; index < collection.length; index++) {
    const message = collection[index];
    if (message === null || typeof message !== "object") continue;
    const markerMetadata = ownProperty(message, "metadata")?.value;
    if (markerMetadata && typeof markerMetadata === "object") {
      deleteOwnProperty(markerMetadata, COMPLETED_AGENT_STEP_STATE_KEY);
    }
  }
}

/** Restore only after the host verifies the owning resume envelope. */
export function restoreCompletedAgentStepReplay(
  messages: Message[],
  runId: string,
  completedSteps: number,
): CompletedAgentStepLoopState {
  const last = messages?.[messages.length - 1];
  const metadata = last ? ownProperty(last, "metadata")?.value : undefined;
  const state = metadata && typeof metadata === "object"
    ? ownProperty(metadata, COMPLETED_AGENT_STEP_STATE_KEY)?.value
    : undefined;
  // Strip transport-only markers even when their binding is invalid.
  stripCompletedStepMarkers(messages);
  if (
    !state || typeof state !== "object" || !messages ||
    ownProperty(state, "runId")?.value !== runId ||
    ownProperty(state, "completedSteps")?.value !== completedSteps
  ) throw new Error("Retained completed-step checkpoint binding is invalid");
  // Rebind provider-private state only from this verified checkpoint. It must
  // remain in the private message store, never in messages exposed to callers.
  const providerReplayMetadata = ownProperty(state, "providerReplayMetadata")?.value;
  if (arrayIsArray(providerReplayMetadata)) {
    for (let index = 0; index < providerReplayMetadata.length; index++) {
      const entry = providerReplayMetadata[index];
      if (!entry || typeof entry !== "object") continue;
      const messageIndex = ownProperty(entry, "messageIndex")?.value;
      const providerMetadata = ownProperty(entry, "providerMetadata")?.value;
      if (
        typeof messageIndex !== "number" || !numberIsSafeInteger(messageIndex) ||
        messageIndex < 0 || messageIndex >= messages.length || !providerMetadata ||
        typeof providerMetadata !== "object" || arrayIsArray(providerMetadata)
      ) continue;
      const message = messages[messageIndex]!;
      attachProviderMetadata(message, providerMetadata);
      if (ownProperty(entry, "replayDelivered")?.value === true) {
        markProviderReplayDelivered(message);
      }
    }
  }
  const rawIndexes = ownProperty(state, "runtimeGeneratedMessageIndexes")?.value;
  const indexes = arrayIsArray(rawIndexes)
    ? filterPrivateArray(
      rawIndexes,
      (index: unknown): index is number =>
        typeof index === "number" && numberIsSafeInteger(index) && index >= 0 &&
        index < messages.length,
    )
    : [];
  for (let index = 0; index < indexes.length; index++) {
    const message = messages[indexes[index]!]!;
    if (message.role === "user") markRuntimeGeneratedUserMessage(message);
  }
  const overrides = ownProperty(state, "activeSkillDelegationOverrides")?.value;
  const recoveryStep = ownProperty(state, "interruptedLocalToolBatchRecoveryStep")?.value;
  const recoveryText = ownProperty(state, "interruptedLocalToolBatchRecoveryText")?.value;
  return {
    agentWriteFinalResponseGuard:
      ownProperty(state, "agentWriteFinalResponseGuard")?.value === true,
    hasCompletedTool: ownProperty(state, "hasCompletedTool")?.value === true,
    recoveredEmptyResponse: ownProperty(state, "recoveredEmptyResponse")?.value === true,
    recoveredInterruptedLocalToolBatch:
      ownProperty(state, "recoveredInterruptedLocalToolBatch")?.value === true,
    ...(recoveryStep === completedSteps && typeof recoveryText === "string"
      ? {
        interruptedLocalToolBatchRecoveryStep: completedSteps,
        interruptedLocalToolBatchRecoveryText: recoveryText,
      }
      : {}),
    hasSubmittedFormInput: ownProperty(state, "hasSubmittedFormInput")?.value === true,
    ...(overrides !== undefined
      ? { activeSkillDelegationOverrides: extractSkillDelegationOverrides(overrides) }
      : {}),
    runtimeGeneratedMessageIndexes: indexes,
  };
}
