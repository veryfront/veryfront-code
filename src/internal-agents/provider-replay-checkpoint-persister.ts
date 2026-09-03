import {
  MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
  MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
} from "#veryfront/agent/runtime/provider-replay-limits.ts";
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

// Capturing JSON.stringify is not enough on its own: it performs a dynamic
// `toJSON` lookup on every object and array it visits and reads properties
// through their getters. The append body must therefore be rebuilt out of
// null-prototype containers before it is serialized, so project code loaded
// during discovery cannot install Object.prototype.toJSON, observe the private
// checkpoint, and substitute the bytes appended under the run event token.
const objectCreate = Object.create;
const setPrototypeOf = Object.setPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const reflectOwnKeys = Reflect.ownKeys;
const isArray = Array.isArray;

/**
 * Descriptor objects returned by `Object.getOwnPropertyDescriptor` are ordinary
 * objects that inherit from `Object.prototype`, so a plain `descriptor.get`
 * read on a data descriptor resolves through that shared prototype and would
 * invoke a tenant-installed accessor with the descriptor as `this`. Every
 * descriptor field is therefore probed as an own property first.
 */
function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

/** Marks values JSON.stringify drops, so detaching reproduces its output. */
const OMITTED = Symbol("omitted-json-value");

function createDetachedObject(): Record<string, unknown> {
  return apply(objectCreate, Object, [null]) as Record<string, unknown>;
}

function createDetachedArray(): unknown[] {
  // Detach before writing: a poisoned Array.prototype index accessor would
  // otherwise observe or rewrite entries as they are assigned.
  return apply(setPrototypeOf, Object, [[], null]) as unknown[];
}

/** A JSON container the copier reads own data properties from. */
type DetachableContainer = Record<string, unknown> | readonly unknown[];

/** Read an own enumerable data property; accessors are never invoked. */
function readDetachableProperty(target: DetachableContainer, key: string): unknown {
  const descriptor = apply(getOwnPropertyDescriptor, Object, [target, key]) as
    | PropertyDescriptor
    | undefined;
  if (descriptor === undefined) return OMITTED;
  // A data descriptor owns `value`; an accessor descriptor owns `get`/`set`
  // instead. Testing for the own `value` field keeps accessors out without ever
  // reading a field the descriptor lacks through `Object.prototype`.
  if (!hasOwn(descriptor, "value")) return OMITTED;
  if (!hasOwn(descriptor, "enumerable") || descriptor.enumerable !== true) return OMITTED;
  return descriptor.value;
}

/** Copy a validated JSON value into containers no tenant prototype can reach. */
function detachJsonValue(value: unknown, depth: number, budget: { nodes: number }): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (
    typeof value === "undefined" || typeof value === "function" || typeof value === "symbol"
  ) {
    return OMITTED;
  }
  if (typeof value !== "object") {
    // bigint, and any other primitive JSON.stringify refuses to represent.
    throw persistenceFailure("Provider replay checkpoint carries a non-serializable value");
  }
  // Root sits at depth 0 and the maximum depth is inclusive, matching the
  // `depth > maxDepth` rule the snapshot validator behind
  // `parseProviderReplayCheckpointEvent` applies. Keeping the two in step means
  // the persister never rejects a checkpoint that read-back would accept.
  if (depth > MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH) {
    throw persistenceFailure("Provider replay checkpoint exceeds the serializable depth bound");
  }
  if (budget.nodes <= 0) {
    throw persistenceFailure("Provider replay checkpoint exceeds the serializable node bound");
  }
  budget.nodes -= 1;

  if (isArray(value)) {
    const detached = createDetachedArray();
    // `length` is a non-enumerable own data property on every array exotic
    // object, so it is read directly rather than through the enumerable check.
    const lengthDescriptor = apply(getOwnPropertyDescriptor, Object, [value, "length"]) as
      | PropertyDescriptor
      | undefined;
    const length = lengthDescriptor !== undefined && hasOwn(lengthDescriptor, "value") &&
        typeof lengthDescriptor.value === "number"
      ? lengthDescriptor.value
      : 0;
    for (let index = 0; index < length; index += 1) {
      const entry = detachJsonValue(readDetachableProperty(value, `${index}`), depth + 1, budget);
      // JSON.stringify writes null for array entries it cannot represent.
      detached[index] = entry === OMITTED ? null : entry;
    }
    return detached;
  }

  const record = value as Record<string, unknown>;
  const detached = createDetachedObject();
  // `Reflect.ownKeys` hands back an ordinary array, so `for...of` would resolve
  // `Symbol.iterator` through the shared `Array.prototype` and hand a tenant
  // hook the private field names — along with the chance to drop, reorder, or
  // never finish yielding them. Indexed reads of own data properties keep the
  // key list out of reach of every shared prototype.
  const keys = apply(reflectOwnKeys, Reflect, [record]) as (string | symbol)[];
  const keysLengthDescriptor = apply(getOwnPropertyDescriptor, Object, [keys, "length"]) as
    | PropertyDescriptor
    | undefined;
  const keyCount = keysLengthDescriptor !== undefined && hasOwn(keysLengthDescriptor, "value") &&
      typeof keysLengthDescriptor.value === "number"
    ? keysLengthDescriptor.value
    : 0;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const key = readDetachableProperty(keys, `${keyIndex}`);
    // JSON.stringify only serializes string keys.
    if (typeof key !== "string") continue;
    const property = readDetachableProperty(record, key);
    if (property === OMITTED) continue;
    const detachedProperty = detachJsonValue(property, depth + 1, budget);
    if (detachedProperty === OMITTED) continue;
    detached[key] = detachedProperty;
  }
  return detached;
}

/** Serialize the privileged append body without touching a shared prototype. */
function serializeCheckpointAppendBody(checkpoint: ProviderReplayCheckpoint): string {
  const budget = { nodes: MAX_PROVIDER_REPLAY_RAW_METADATA_NODES };
  const event = detachJsonValue(createProviderReplayCheckpointEvent(checkpoint), 0, budget);
  if (event === OMITTED || event === null) {
    throw persistenceFailure("Provider replay checkpoint is not serializable");
  }
  const events = createDetachedArray();
  events[0] = event;
  const body = createDetachedObject();
  body.events = events;
  return apply(jsonStringify, JSON, [body]) as string;
}

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

    const body = serializeCheckpointAppendBody(checkpoint);
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
        body,
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
