import { joinPrivateAbortSignals } from "#veryfront/security/private-abort.ts";
import {
  getCurrentToolCallOccurrenceIdentity,
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createInputRequestApprovalGate } from "#veryfront/tool/approval-input-request-gate.ts";
import type { ToolApprovalGate } from "#veryfront/tool/approval.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { requireHostPrivateApiHttps } from "#veryfront/config/host-api-base.ts";

const capabilities = createPrivateWeakStore<
  object,
  Readonly<{ runId: string; gate: ToolApprovalGate }>
>();
const freeze = Object.freeze;

/** Host-only construction after canonical admission. Nothing is added to the carrier's public fields. */
export function registerHostedToolApprovalCapability(target: object, input: {
  runId: string;
  /** Verified canonical API target when the execution context uses a legacy routing alias. */
  approvalRunId?: string;
  apiUrl: string;
  authToken: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): void {
  const apiUrl = requireHostPrivateApiHttps(input.apiUrl);
  const lifetime = input.signal;
  const gate = createInputRequestApprovalGate(freeze({
    apiUrl,
    runId: input.approvalRunId ?? input.runId,
    authToken: input.authToken,
    fetch: input.fetch ?? createVeryfrontApiOriginBoundOutboundFetch(apiUrl),
  }));
  const bound: ToolApprovalGate = (request, signal) => {
    const combined = lifetime && signal
      ? joinPrivateAbortSignals(lifetime, signal)
      : lifetime ?? signal;
    combined?.throwIfAborted();
    const occurrence = getCurrentToolCallOccurrenceIdentity();
    if (!request.toolCallId || occurrence?.toolCallId === request.toolCallId) {
      return gate(request, combined);
    }
    // Metadata-only channel dispatch may have no local engine scope. Each admitted request
    // then gets a fresh host occurrence; a reused provider id cannot replay a previous approval.
    const call = { id: request.toolCallId };
    return runWithToolCallOccurrences(() => {
      introduceToolCallOccurrence(call);
      return runWithToolCallOccurrenceDispatch(call, () => gate(request, combined));
    });
  };
  capabilities.set(target, freeze({ runId: input.runId, gate: bound }));
}

/** Carry only the already-admitted host capability across framework-owned copies. */
export function inheritHostedToolApprovalCapability(target: object, source: object): void {
  const capability = capabilities.get(source);
  if (capability) capabilities.set(target, capability);
}

/** Public run identifiers alone cannot create an approval channel. */
export function getHostedToolApprovalCapability(
  target: object,
  runId: string | undefined,
): ToolApprovalGate | undefined {
  const capability = capabilities.get(target);
  return capability?.runId === runId ? capability?.gate : undefined;
}
