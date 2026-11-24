import { createInstrumentedFetch } from "#veryfront/observability/auto-instrument/http-instrumentation.ts";
import { isGlobalTracerProviderInstalled } from "#veryfront/observability/tracing/api-shim.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { readResponseBytesPrefix } from "#veryfront/utils/response-body.ts";
import { terminalRoute } from "../conversation/terminal-route.ts";
import { BrokerIngressError } from "./broker-ingress.ts";

const getAdmissionReceipt = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    accepted: v.literal(true),
    identity: v.object({
      project_id: v.string().uuid(),
      canonical_run_id: v.string().uuid(),
      public_run_id: v.string().min(1).max(256),
    }).strict(),
    generation: v.object({
      worker_id: v.string().min(1).max(256),
      dispatch_nonce: v.string().uuid(),
      transport_recovery_attempt: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }).strict(),
    lease_remaining_ms: v.number().int().min(1).max(300_000),
    acknowledged_event_id: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    acknowledged_external_sequence: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict()
);

/** Best-effort disposal must preserve the admission result, including synchronous failures. */
function cancelResponseBody(response: Response): void {
  void Promise.resolve().then(() => response.body?.cancel()).catch(() => {});
}

/** Consume the dispatch in the API before any deployment callback can allocate or execute. */
export async function claimManagedBrokerAdmission(input: {
  apiUrl: string;
  authToken: string;
  terminalAuthToken: string;
  projectId: string;
  runId: string;
  canonicalRunId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const terminal = terminalRoute(input.terminalAuthToken, input.runId);
  if (terminal.id !== input.canonicalRunId) {
    throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
  }
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("Runtime admission timed out", "TimeoutError")),
    5_000,
  );
  const signal = AbortSignal.any([input.signal, deadline.signal]);
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    const transport = input.fetch ??
      (isGlobalTracerProviderInstalled()
        ? createInstrumentedFetch(globalThis.fetch)
        : globalThis.fetch);
    response = await transport(
      `${input.apiUrl}/runs/${encodeURIComponent(input.canonicalRunId)}/runtime/admission`,
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${input.authToken}`,
          "content-type": "application/json",
          "X-Veryfront-Run-Terminal-Token": input.terminalAuthToken,
        },
        body: JSON.stringify({
          latest_event_id: input.latestEventId,
          latest_external_event_sequence: input.latestExternalEventSequence,
        }),
      },
    );
    if (response.status !== 200) {
      throw response.status === 409
        ? new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE")
        : response.status === 401 || response.status === 403
        ? new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED")
        : new BrokerIngressError(503, "BROKER_UNAVAILABLE");
    }
    const body = await readResponseBytesPrefix(response, 16 * 1024, signal);
    if (body.truncated) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
    const receipt = getAdmissionReceipt().parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)),
    );
    if (
      receipt.identity.project_id !== input.projectId ||
      receipt.identity.canonical_run_id !== input.canonicalRunId ||
      receipt.identity.public_run_id !== input.runId ||
      receipt.generation.dispatch_nonce !== terminal.generation ||
      receipt.acknowledged_event_id !== input.latestEventId ||
      receipt.acknowledged_external_sequence !== input.latestExternalEventSequence
    ) {
      throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
    }
    signal.throwIfAborted();
  } catch (error) {
    // A caller can abort immediately after headers arrive, before the bounded
    // reader owns the body. Cancel that unread response without waiting on it.
    if (response?.body && !response.bodyUsed) {
      cancelResponseBody(response);
    }
    if (error instanceof BrokerIngressError) throw error;
    const failure = new BrokerIngressError(503, "BROKER_UNAVAILABLE");
    Object.defineProperty(failure, "cause", { value: error });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
