import { AsyncLocalStorage } from "node:async_hooks";
import {
  createVeryfrontApiRequestUrlResolver,
  type VeryfrontApiRequestUrlResolver,
} from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  type ConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorOptions,
} from "../conversation/run-chunk-mirror.ts";

const DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS = 10_000;
const MAX_CHILD_RUN_EVENT_WRITER_TOKEN_BYTES = 4 * 1024;
const MAX_CHILD_RUN_EVENT_WRITER_TOKEN_RESPONSE_BYTES = 16 * 1024;
const CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR =
  "Unable to initialize durable child event persistence";
const utf8Encoder = new TextEncoder();

type Fetch = typeof globalThis.fetch;

/** Internal failure raised when the control plane cannot issue an exact-child writer token. */
export class HostedChildRunEventWriterTokenExchangeError extends Error {
  readonly classification: "aborted" | "timeout" | "failed";

  constructor(classification: "aborted" | "timeout" | "failed" = "failed") {
    super(CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR);
    this.name = "HostedChildRunEventWriterTokenExchangeError";
    this.classification = classification;
  }
}

/**
 * Opaque authority for appending events to one exact hosted run.
 *
 * The credential is retained in module-private state and is not exposed as a
 * property of the capability. A capability can mint authority only for a
 * persisted direct child run.
 */
export interface HostedRunEventWriterCapability {
  /** Exchange this run's authority for an exact direct-child capability. */
  mintChildRunEventAppendToken(
    childRunId: string,
    abortSignal?: AbortSignal,
  ): Promise<HostedRunEventWriterCapability>;
}

type CapabilityState = {
  apiUrl: string;
  resolveApiUrl: VeryfrontApiRequestUrlResolver;
  runId: string;
  runEventAppendToken: string;
  timeoutMs: number;
  fetch: Fetch;
};

type CapabilityScope = {
  active: boolean;
  capability: HostedRunEventWriterCapability | undefined;
};

type VerifiedRequestWriterState = {
  token: string;
  projectId: string;
  runId: string;
};

type VerifiedRequestWriterScope = {
  active: boolean;
  state: VerifiedRequestWriterState | undefined;
};

const capabilityState = new WeakMap<HostedRunEventWriterCapability, CapabilityState>();
const requestRunEventWriterState = new WeakMap<object, VerifiedRequestWriterState>();
const capabilityStorage = new AsyncLocalStorage<CapabilityScope>();
const verifiedRequestWriterStorage = new AsyncLocalStorage<VerifiedRequestWriterScope>();

function isNoStoreResponse(response: Response): boolean {
  return response.headers.get("Cache-Control")?.split(",").some((directive) =>
    directive.trim().toLowerCase() === "no-store"
  ) ?? false;
}

function isValidRunEventWriterToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.trim() === token &&
    utf8Encoder.encode(token).byteLength <= MAX_CHILD_RUN_EVENT_WRITER_TOKEN_BYTES;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

function parseRunEventToken(value: unknown): string {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, "run_event_token")
  ) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  const token = (value as { run_event_token?: unknown }).run_event_token;
  if (!isValidRunEventWriterToken(token)) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  return token;
}

async function exchangeChildRunEventWriterToken(
  state: CapabilityState,
  childRunId: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  let cancellation: "aborted" | "timeout" | undefined;
  const cancel = (classification: "aborted" | "timeout") => {
    if (controller.signal.aborted) return;
    cancellation = classification;
    controller.abort();
  };
  const onAbort = () => cancel("aborted");
  if (abortSignal?.aborted) {
    cancel("aborted");
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }
  const timeoutId = setTimeout(() => cancel("timeout"), state.timeoutMs);
  const url = state.resolveApiUrl(
    `/runs/${encodeURIComponent(state.runId)}/children/${
      encodeURIComponent(childRunId)
    }/event-writer-token`,
  );

  try {
    const response = await state.fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.runEventAppendToken}`,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (cancellation) {
      throw new HostedChildRunEventWriterTokenExchangeError(cancellation);
    }

    if (!response.ok || !isNoStoreResponse(response)) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }

    const responseBody = await readResponseTextPrefix(
      response,
      MAX_CHILD_RUN_EVENT_WRITER_TOKEN_RESPONSE_BYTES,
      controller.signal,
    );
    if (responseBody.truncated) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }
    let responseValue: unknown;
    try {
      responseValue = JSON.parse(responseBody.text);
    } catch {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }
    const token = parseRunEventToken(responseValue);
    if (cancellation) {
      throw new HostedChildRunEventWriterTokenExchangeError(cancellation);
    }
    return token;
  } catch (error) {
    if (error instanceof HostedChildRunEventWriterTokenExchangeError) throw error;
    throw new HostedChildRunEventWriterTokenExchangeError(cancellation ?? "failed");
  } finally {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

/** Retain verified ingress authority without adding it to the parsed request contract. */
export function registerHostedRunEventWriterToken(
  request: object,
  input: VerifiedRequestWriterState,
): void {
  requestRunEventWriterState.set(request, input);
}

/** Create the opaque exact-run capability associated with a verified parsed request. */
export function createHostedRunEventWriterCapabilityForRequest(
  request: object,
  input: Omit<Parameters<typeof createHostedRunEventWriterCapability>[0], "runEventAppendToken">,
): HostedRunEventWriterCapability | undefined {
  const directState = requestRunEventWriterState.get(request);
  const ambientScope = verifiedRequestWriterStorage.getStore();
  const ambientState = ambientScope?.active ? ambientScope.state : undefined;
  const candidateState = directState ?? ambientState;
  const requestRecord = request as Record<string, unknown>;
  const durableRootRun = requestRecord.durableRootRun;
  const matchesAmbientRequest = directState !== undefined ||
    (candidateState !== undefined &&
      requestRecord.projectId === candidateState.projectId &&
      typeof durableRootRun === "object" && durableRootRun !== null &&
      (durableRootRun as Record<string, unknown>).runId === candidateState.runId);
  const token = matchesAmbientRequest && candidateState?.runId === input.runId
    ? candidateState.token
    : undefined;
  return token
    ? createHostedRunEventWriterCapability({ ...input, runEventAppendToken: token })
    : undefined;
}

/** Allow identity-preserving request clones to reuse a verified writer during preparation. */
export async function runWithVerifiedHostedRunEventWriterRequest<T>(
  request: object,
  operation: () => T | Promise<T>,
): Promise<T> {
  const scope: VerifiedRequestWriterScope = {
    active: true,
    state: requestRunEventWriterState.get(request),
  };
  try {
    return await verifiedRequestWriterStorage.run(scope, operation);
  } finally {
    scope.active = false;
    scope.state = undefined;
  }
}

/**
 * Create an exact-run event-writer capability from a credential verified by
 * trusted ingress. General user API tokens are not run-event credentials.
 * The returned frozen object does not expose or serialize the credential.
 */
export function createHostedRunEventWriterCapability(input: {
  /** Trusted Veryfront API origin used for child-capability exchange. */
  apiUrl: string;
  /** Exact run authorized by `runEventAppendToken`. */
  runId: string;
  /** Exact-run append credential obtained from trusted ingress. */
  runEventAppendToken: string;
  /** Bounded child-capability exchange timeout. */
  timeoutMs?: number;
  /** Test or host transport override. */
  fetch?: Fetch;
}): HostedRunEventWriterCapability {
  if (!isValidRunEventWriterToken(input.runEventAppendToken)) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }
  const state: CapabilityState = {
    apiUrl: input.apiUrl,
    resolveApiUrl: createVeryfrontApiRequestUrlResolver(input.apiUrl),
    runId: input.runId,
    runEventAppendToken: input.runEventAppendToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS,
    fetch: input.fetch ?? globalThis.fetch,
  };
  const capability = Object.create(null) as HostedRunEventWriterCapability;
  Object.defineProperty(capability, "mintChildRunEventAppendToken", {
    enumerable: false,
    value: async (childRunId: string, abortSignal?: AbortSignal) => {
      const childToken = await exchangeChildRunEventWriterToken(state, childRunId, abortSignal);
      return createHostedRunEventWriterCapability({
        apiUrl: state.apiUrl,
        runId: childRunId,
        runEventAppendToken: childToken,
        timeoutMs: state.timeoutMs,
        fetch: state.fetch,
      });
    },
  });
  capabilityState.set(capability, state);
  return Object.freeze(capability);
}

/** Build a durable mirror from private capability state without exposing its credential. */
export function createHostedConversationRunChunkMirrorFromCapability(
  capability: HostedRunEventWriterCapability | undefined,
  input: Omit<HostedConversationRunChunkMirrorOptions, "apiUrl" | "authToken" | "runId">,
): ConversationRunChunkMirror | undefined {
  if (!capability) return undefined;
  const state = capabilityState.get(capability);
  if (!state) return undefined;
  return createHostedConversationRunChunkMirror({
    ...input,
    apiUrl: state.apiUrl,
    authToken: state.runEventAppendToken,
    runId: state.runId,
  });
}

/** Return the capability installed only while internal tool closures are assembled. */
export function getActiveHostedRunEventWriterCapability():
  | HostedRunEventWriterCapability
  | undefined {
  const scope = capabilityStorage.getStore();
  return scope?.active ? scope.capability : undefined;
}

/** Run a bounded internal scope with privately bound exact-run authority. */
export function runWithHostedRunEventWriterCapability<T>(
  capability: HostedRunEventWriterCapability | undefined,
  operation: () => T,
): T {
  const scope: CapabilityScope = { active: true, capability };
  const revoke = () => {
    scope.active = false;
    scope.capability = undefined;
  };
  try {
    const result = capabilityStorage.run(scope, operation);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(revoke) as T;
    }
    revoke();
    return result;
  } catch (error) {
    revoke();
    throw error;
  }
}
