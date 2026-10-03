import { hostedInheritedRunAdmitter, hostedTerminalCanonicalRunId } from "./terminal-credential.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES } from "../conversation/run-event-limits.ts";
import {
  createVeryfrontApiRequestUrlResolver,
  type VeryfrontApiRequestUrlResolver,
} from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { instrumentConversationRunFetch } from "../conversation/durable.ts";
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

type Fetch = typeof globalThis.fetch;

// These intrinsics are captured before tenant code can mutate the shared realm.
// Secret-bearing operations below must use only these references.
const NativeTextEncoder = TextEncoder;
const NativeWeakMap = WeakMap;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arraySome = Array.prototype.some;
const jsonParse = JSON.parse;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSplit = String.prototype.split;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const weakMapGet = NativeWeakMap.prototype.get;
const weakMapSet = NativeWeakMap.prototype.set;
const asyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;
const asyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGetterCandidate = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const hostFetch = globalThis.fetch;
const utf8Encoder = new NativeTextEncoder();

if (typeof typedArrayByteLengthGetterCandidate !== "function") {
  throw new TypeError("Required Uint8Array byteLength intrinsic is unavailable");
}
const typedArrayByteLengthGetter = typedArrayByteLengthGetterCandidate;

function getWeakMapValue<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return apply(weakMapGet, map, [key]) as V | undefined;
}

function setWeakMapValue<K extends object, V>(map: WeakMap<K, V>, key: K, value: V): void {
  apply(weakMapSet, map, [key, value]);
}

function getAsyncStore<T>(storage: AsyncLocalStorage<T>): T | undefined {
  return apply(asyncLocalStorageGetStore, storage, []) as T | undefined;
}

function runInAsyncStore<TStore, TResult>(
  storage: AsyncLocalStorage<TStore>,
  store: TStore,
  operation: () => TResult,
): TResult {
  return apply(asyncLocalStorageRun, storage, [store, operation]) as TResult;
}

function trim(value: string): string {
  return apply(stringTrim, value, []) as string;
}

function capturedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return apply(hostFetch, globalThis, [input, init]) as Promise<Response>;
}

function snapshotFetch(fetchImpl: Fetch): Fetch {
  return (input, init) => apply(fetchImpl, undefined, [input, init]) as Promise<Response>;
}

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
  mintChildRunEventWriterCapability(
    childRunId: string,
    abortSignal?: AbortSignal,
    canonicalChildRunId?: string,
  ): Promise<HostedRunEventWriterCapability>;
}

type CapabilityState = {
  inheritedExecution?: boolean;
  inheritedAdmitter?: ReturnType<typeof hostedInheritedRunAdmitter>;
  apiUrl: string;
  resolveApiUrl: VeryfrontApiRequestUrlResolver;
  runId: string;
  canonicalRunId?: string;
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
  /** Explicit trusted-host or test transport retained with verified ingress. */
  fetch?: Fetch;
};

type VerifiedRequestWriterScope = {
  active: boolean;
  state: VerifiedRequestWriterState | undefined;
};

const capabilityState = new NativeWeakMap<HostedRunEventWriterCapability, CapabilityState>();
const requestRunEventWriterState = new NativeWeakMap<object, VerifiedRequestWriterState>();
const capabilityStorage = new AsyncLocalStorage<CapabilityScope>();
const verifiedRequestWriterStorage = new AsyncLocalStorage<VerifiedRequestWriterScope>();

function isNoStoreResponse(response: Response): boolean {
  const value = response.headers.get("Cache-Control");
  if (value === null) return false;
  const directives = apply(stringSplit, value, [","]) as string[];
  return apply(arraySome, directives, [
    (directive: string) => apply(stringToLowerCase, trim(directive), []) === "no-store",
  ]) as boolean;
}

function isValidRunEventWriterToken(
  token: unknown,
  maxBytes = MAX_CHILD_RUN_EVENT_WRITER_TOKEN_BYTES,
): token is string {
  if (typeof token !== "string" || token.length === 0 || trim(token) !== token) {
    return false;
  }
  const encoded = apply(textEncoderEncode, utf8Encoder, [token]) as Uint8Array;
  const byteLength = apply(typedArrayByteLengthGetter, encoded, []) as number;
  return byteLength <= maxBytes;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

function isRunUuid(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 36) return false;
  for (let index = 0; index < 36; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const hyphen = index === 8 || index === 13 || index === 18 || index === 23;
    const hex = (code >= 48 && code <= 57) || (code >= 97 && code <= 102) ||
      (code >= 65 && code <= 70);
    if (hyphen ? code !== 45 : !hex) return false;
  }
  return true;
}

function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return apply(objectHasOwnProperty, value, [key])
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function parseRunEventToken(value: unknown, canonicalChildRunId: string): string {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }
  const token = ownValue(value, "token");
  const permissions = ownValue(value, "permissions");
  if (
    !isValidRunEventWriterToken(token) ||
    ownValue(value, "token_type") !== "Bearer" ||
    ownValue(value, "run_id") !== canonicalChildRunId ||
    typeof ownValue(value, "expires_at") !== "string" ||
    !arrayIsArray(permissions) || permissions.length !== 1 ||
    permissions[0] !== "run.events.append"
  ) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }
  return token;
}

async function exchangeChildRunEventWriterToken(
  state: CapabilityState,
  canonicalChildRunId: string,
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
    `/runs/${encodeURIComponent(canonicalChildRunId)}/event-tokens`,
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
      responseValue = apply(jsonParse, undefined, [responseBody.text]);
    } catch {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }
    const token = parseRunEventToken(responseValue, canonicalChildRunId);
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
  setWeakMapValue(requestRunEventWriterState, request, input);
}

/** Create the opaque exact-run capability associated with a verified parsed request. */
export function createHostedRunEventWriterCapabilityForRequest(
  request: object,
  input: Omit<Parameters<typeof createHostedRunEventWriterCapability>[0], "runEventAppendToken">,
): HostedRunEventWriterCapability | undefined {
  const directState = getWeakMapValue(requestRunEventWriterState, request);
  const ambientScope = getAsyncStore(verifiedRequestWriterStorage);
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
    ? createHostedRunEventWriterCapability({
      ...input,
      runEventAppendToken: token,
      canonicalRunId: input.canonicalRunId ?? hostedTerminalCanonicalRunId(request),
      inheritedAdmitter: hostedInheritedRunAdmitter(request, input),
      fetch: input.fetch ?? candidateState?.fetch,
    })
    : undefined;
}

/** Allow identity-preserving request clones to reuse a verified writer during preparation. */
export async function runWithVerifiedHostedRunEventWriterRequest<T>(
  request: object,
  operation: () => T | Promise<T>,
): Promise<T> {
  const scope: VerifiedRequestWriterScope = {
    active: true,
    state: getWeakMapValue(requestRunEventWriterState, request),
  };
  try {
    return await runInAsyncStore(verifiedRequestWriterStorage, scope, operation);
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
  /** Whether this generation executes an attached local callback. */
  inheritedExecution?: boolean;
  /** Trusted Veryfront API base URL used for child-capability exchange. */
  apiUrl: string;
  /** Exact run authorized by `runEventAppendToken`. */
  runId: string;
  /** Canonical routing UUID supplied by trusted dispatch. */
  canonicalRunId?: string;
  inheritedAdmitter?: ReturnType<typeof hostedInheritedRunAdmitter>;
  /** Exact-run append credential obtained from trusted ingress. */
  runEventAppendToken: string;
  /** Bounded child-capability exchange timeout. */
  timeoutMs?: number;
  /** Explicit trusted-host or test transport; tenant code must omit this seam. */
  fetch?: Fetch;
}): HostedRunEventWriterCapability {
  if (
    !isValidRunEventWriterToken(input.runEventAppendToken, MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES)
  ) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }
  const state: CapabilityState = {
    inheritedExecution: input.inheritedExecution,
    apiUrl: input.apiUrl,
    resolveApiUrl: createVeryfrontApiRequestUrlResolver(input.apiUrl),
    runId: input.runId,
    canonicalRunId: input.canonicalRunId,
    inheritedAdmitter: input.inheritedAdmitter,
    runEventAppendToken: input.runEventAppendToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS,
    fetch: input.fetch ? snapshotFetch(input.fetch) : capturedFetch,
  };
  const capability = objectCreate(null) as HostedRunEventWriterCapability;
  objectDefineProperty(capability, "mintChildRunEventWriterCapability", {
    enumerable: false,
    value: async (childRunId: string, abortSignal?: AbortSignal, canonicalChildRunId?: string) => {
      const canonical = canonicalChildRunId ?? childRunId;
      if (!isRunUuid(canonical)) {
        throw new HostedChildRunEventWriterTokenExchangeError();
      }
      const childToken = await exchangeChildRunEventWriterToken(state, canonical, abortSignal);
      return createHostedRunEventWriterCapability({
        apiUrl: state.apiUrl,
        runId: childRunId,
        canonicalRunId: canonical,
        runEventAppendToken: childToken,
        timeoutMs: state.timeoutMs,
        fetch: state.fetch,
      });
    },
  });
  setWeakMapValue(capabilityState, capability, state);
  return objectFreeze(capability);
}

/** Build a durable mirror from private capability state without exposing its credential. */
export function createHostedConversationRunChunkMirrorFromCapability(
  capability: HostedRunEventWriterCapability | undefined,
  input:
    & Omit<HostedConversationRunChunkMirrorOptions, "apiUrl" | "authToken" | "runId" | "fetch">
    & {
      /** Exact durable run for which the caller is preparing a mirror. */
      expectedRunId: string;
    },
): ConversationRunChunkMirror | undefined {
  if (!capability) return undefined;
  const state = getWeakMapValue(capabilityState, capability);
  if (!state || state.runId !== input.expectedRunId) return undefined;
  const { expectedRunId: _expectedRunId, ...mirrorInput } = input;
  return createHostedConversationRunChunkMirror({
    ...mirrorInput,
    apiUrl: state.apiUrl,
    authToken: state.runEventAppendToken,
    runId: state.runId,
    canonicalRunId: state.canonicalRunId,
    // Capability transports are host-owned, but durable persistence still
    // needs to stay in the active execution trace.
    fetch: instrumentConversationRunFetch(state.fetch),
  });
}

/** Return a routing identifier only for the exact run bound to this capability. */
export function hostedRunCanonicalId(
  capability: HostedRunEventWriterCapability | undefined,
  expectedRunId: string,
): string | undefined {
  if (!capability) return undefined;
  const state = getWeakMapValue(capabilityState, capability);
  return state?.runId === expectedRunId ? state.canonicalRunId : undefined;
}

/** Return the capability installed only while internal tool closures are assembled. */
export function getActiveHostedRunEventWriterCapability():
  | HostedRunEventWriterCapability
  | undefined {
  const scope = getAsyncStore(capabilityStorage);
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
    const result = runInAsyncStore(capabilityStorage, scope, operation);
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

/** Obtain a parent-bound admission closure without disclosing its credential. */
export function inheritedChildAdmitter(
  capability: HostedRunEventWriterCapability | undefined,
  parentRunId: string,
  toolCallId: string,
  prompt: string,
) {
  const state = capability ? getWeakMapValue(capabilityState, capability) : undefined;
  if (!state || state.runId !== parentRunId || !state.inheritedAdmitter) {
    throw new Error("Inherited child admission authority is required");
  }
  return state.inheritedAdmitter(toolCallId, prompt);
}

/** Check the private execution mode of the exact run preparing its tools. */
export function hostedRunIsInherited(
  capability: HostedRunEventWriterCapability | undefined,
  runId: string,
): boolean {
  const state = capability ? getWeakMapValue(capabilityState, capability) : undefined;
  return state?.runId === runId && state.inheritedExecution === true;
}
