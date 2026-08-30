import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED } from "#veryfront/errors";
import {
  createVeryfrontApiRequestUrlResolver,
  type VeryfrontApiRequestUrlResolver,
} from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";

const DEFAULT_PROVIDER_REPLAY_APPEND_TIMEOUT_MS = 15_000;
const MAX_RUN_EVENT_APPEND_TOKEN_BYTES = 4 * 1024;

type Fetch = typeof globalThis.fetch;

// Capture credential-touching intrinsics before project code can mutate the
// shared realm. The opaque writer token must never be passed to ambient
// prototype methods after project discovery.
const NativeTextEncoder = TextEncoder;
const apply = Reflect.apply;
const jsonStringify = JSON.stringify;
const stringTrim = String.prototype.trim;
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGetterCandidate = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const textEncoder = new NativeTextEncoder();

if (typeof typedArrayByteLengthGetterCandidate !== "function") {
  throw new TypeError("Required Uint8Array byteLength intrinsic is unavailable");
}
const typedArrayByteLengthGetter = typedArrayByteLengthGetterCandidate;

function snapshotFetch(fetchImpl: Fetch): Fetch {
  return (input, init) => apply(fetchImpl, undefined, [input, init]) as Promise<Response>;
}

function isValidRunEventAppendToken(token: string | null | undefined): token is string {
  if (
    typeof token !== "string" || token.length === 0 ||
    apply(stringTrim, token, []) !== token
  ) {
    return false;
  }
  const encoded = apply(textEncoderEncode, textEncoder, [token]) as Uint8Array;
  return (apply(typedArrayByteLengthGetter, encoded, []) as number) <=
    MAX_RUN_EVENT_APPEND_TOKEN_BYTES;
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function persistenceFailure(detail: string) {
  return DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({ detail });
}

/** Trusted host callback that durably appends checkpoints before continuation. */
export type ProviderReplayCheckpointPersister = (
  checkpoint: ProviderReplayCheckpoint,
  abortSignal?: AbortSignal,
) => Promise<void>;

/** Create an exact-run checkpoint writer backed by the API's durable append route. */
export function createRunScopedProviderReplayCheckpointPersister(input: {
  apiUrl: string;
  runId: string;
  runEventAppendToken: string | null | undefined;
  timeoutMs?: number;
  /** Explicit host-owned transport for tests. */
  fetch?: Fetch;
}): ProviderReplayCheckpointPersister | undefined {
  if (!isValidRunEventAppendToken(input.runEventAppendToken)) return undefined;

  const token = input.runEventAppendToken;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROVIDER_REPLAY_APPEND_TIMEOUT_MS;
  const fetchImpl = input.fetch
    ? snapshotFetch(input.fetch)
    : createOriginBoundOutboundFetch(input.apiUrl);
  const resolveApiUrl: VeryfrontApiRequestUrlResolver = createVeryfrontApiRequestUrlResolver(
    input.apiUrl,
  );
  const url = resolveApiUrl(`/runs/${encodeURIComponent(input.runId)}/events`);

  return async (checkpoint, abortSignal) => {
    if (abortSignal?.aborted) throw getAbortReason(abortSignal);

    const controller = new AbortController();
    const timeoutError = persistenceFailure("Provider replay checkpoint persistence timed out");
    const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    const onAbort = () => controller.abort(getAbortReason(abortSignal!));
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: apply(jsonStringify, JSON, [{
          events: [createProviderReplayCheckpointEvent(checkpoint)],
        }]) as string,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw persistenceFailure(
          `Provider replay checkpoint append failed with status ${response.status}`,
        );
      }
      await response.body?.cancel().catch(() => undefined);
      if (abortSignal?.aborted) throw getAbortReason(abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) throw getAbortReason(abortSignal);
      if (controller.signal.aborted) throw controller.signal.reason ?? timeoutError;
      if (
        typeof error === "object" && error !== null && "slug" in error &&
        error.slug === DURABLE_RUN_EVENT_PERSISTENCE_FAILED.slug
      ) {
        throw error;
      }
      throw persistenceFailure("Provider replay checkpoint append failed");
    } finally {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  };
}
