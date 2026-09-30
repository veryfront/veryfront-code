/**
 * Run credentials taken off an inbound request before framework code reads it.
 *
 * The proxy's `x-token` and the control plane's inference and run-event
 * tokens arrive as request headers. Project code shares the isolate with the request pipeline
 * and can replace `Headers.prototype` methods, so any framework header read on
 * a request that still carries them (`get("origin")` in a CORS builder, say)
 * would hand the whole header list to that replacement. The runtime handler
 * therefore swaps the request for a copy without those headers as its first
 * step, using only primitives captured when this module loads, and keeps the
 * values in module-private storage keyed by the request.
 *
 * @module security/http/ingress-credentials
 */

import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { lockNativeRequestInternals } from "#veryfront/platform/compat/http/native-request-internals.ts";
import { assertNativeHeaderProcessing } from "./native-header-processing.ts";
import { assertNativeRequestDefaults } from "./native-request-processing.ts";

const IntrinsicReflectApply = Reflect.apply;
const NativeHeaders = Headers;
const NativeRequest = Request;
const NativeWeakMap = WeakMap;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const HeadersGet = NativeHeaders.prototype.get;
const HeadersEntries = NativeHeaders.prototype.entries;
const HeadersIteratorNext = Object.getPrototypeOf(new NativeHeaders().entries()).next as (
  this: IterableIterator<[string, string]>,
) => IteratorResult<[string, string]>;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!
  .get!;
const StringToLowerCase = String.prototype.toLowerCase;
const WeakMapDelete = NativeWeakMap.prototype.delete;
const WeakMapGet = NativeWeakMap.prototype.get;
const WeakMapSet = NativeWeakMap.prototype.set;

/** The proxy-injected Veryfront API credential. */
export const INGRESS_API_TOKEN_HEADER = "x-token";
/** The control plane's gateway-only inference credential. */
export const INGRESS_INFERENCE_TOKEN_HEADER = "x-veryfront-inference-token";
/** The control plane's exact-run durable event append credential. */
export const INGRESS_RUN_EVENT_TOKEN_HEADER = "x-veryfront-run-event-token";

export type IngressCredentialHeader =
  | typeof INGRESS_API_TOKEN_HEADER
  | typeof INGRESS_INFERENCE_TOKEN_HEADER
  | typeof INGRESS_RUN_EVENT_TOKEN_HEADER;

type IngressCredentials = { readonly [name in IngressCredentialHeader]: string | null };

const ingressCredentials = new NativeWeakMap<Request, IngressCredentials>();

// Captured accessors still reach the request's headers through symbol-keyed
// prototype internals, so those are locked before project code can run.
lockNativeRequestInternals();

function readNativeHeader(request: Request, name: string): string | null {
  const headers = IntrinsicReflectApply(RequestHeadersGetter, request, []) as Headers;
  return IntrinsicReflectApply(HeadersGet, headers, [name]) as string | null;
}

function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = readNativeHeader(request, "upgrade");
  return upgrade !== null &&
    IntrinsicReflectApply(StringToLowerCase, upgrade, []) === "websocket";
}

/**
 * The request's headers minus both credentials, as a null-prototype record.
 * A Headers object handed to the Request constructor would be read through a
 * patchable `Headers.prototype[Symbol.iterator]`; a record takes no such path.
 */
function toHeaderRecordWithoutCredentials(request: Request): Record<string, string> {
  const record = ObjectCreate(null) as Record<string, string>;
  const headers = IntrinsicReflectApply(RequestHeadersGetter, request, []) as Headers;
  const iterator = IntrinsicReflectApply(HeadersEntries, headers, []) as IterableIterator<
    [string, string]
  >;
  while (true) {
    const step = IntrinsicReflectApply(HeadersIteratorNext, iterator, []) as IteratorResult<
      [string, string]
    >;
    if (step.done) return record;
    // Entries arrive lowercased, so the names compare without normalising.
    const name = step.value[0];
    if (
      name === INGRESS_API_TOKEN_HEADER || name === INGRESS_INFERENCE_TOKEN_HEADER ||
      name === INGRESS_RUN_EVENT_TOKEN_HEADER
    ) continue;
    record[name] = step.value[1];
  }
}

/**
 * The request the runtime pipeline should handle: `request` itself when it
 * carries no credential header, otherwise a copy without them that keeps the
 * URL, method, remaining headers, body, signal and transport peer. Either way
 * the credentials stay readable through {@link readIngressCredential}.
 *
 * A WebSocket upgrade keeps the original request, because Deno can upgrade
 * only the exact Request its server produced; its credentials stay in its
 * headers.
 */
export function sealIngressCredentials(request: Request): Request {
  const credentials: IngressCredentials = ObjectFreeze({
    __proto__: null,
    [INGRESS_API_TOKEN_HEADER]: readNativeHeader(request, INGRESS_API_TOKEN_HEADER),
    [INGRESS_INFERENCE_TOKEN_HEADER]: readNativeHeader(request, INGRESS_INFERENCE_TOKEN_HEADER),
    [INGRESS_RUN_EVENT_TOKEN_HEADER]: readNativeHeader(request, INGRESS_RUN_EVENT_TOKEN_HEADER),
  } as IngressCredentials);
  if (
    (credentials[INGRESS_API_TOKEN_HEADER] === null &&
      credentials[INGRESS_INFERENCE_TOKEN_HEADER] === null &&
      credentials[INGRESS_RUN_EVENT_TOKEN_HEADER] === null) ||
    isWebSocketUpgrade(request)
  ) {
    IntrinsicReflectApply(WeakMapSet, ingressCredentials, [request, credentials]);
    return request;
  }

  assertNativeHeaderProcessing();
  assertNativeRequestDefaults();
  // Null prototype: the constructor reads `body`, `method`, `signal` and the
  // other init fields by name, and an inherited getter would see `headers`.
  const init = ObjectCreate(null) as RequestInit;
  init.headers = toHeaderRecordWithoutCredentials(request);
  const sealed = new NativeRequest(request, init);
  IntrinsicReflectApply(WeakMapSet, ingressCredentials, [sealed, credentials]);
  return inheritRequestPeerProvenance(request, sealed);
}

/**
 * The value `request` arrived with for a credential header, or null. A
 * request that never passed {@link sealIngressCredentials} (a direct handler
 * call, or a service without the runtime pipeline) is read from its headers,
 * through captured accessors.
 */
export function readIngressCredential(
  request: Request,
  name: IngressCredentialHeader,
): string | null {
  const credentials = IntrinsicReflectApply(WeakMapGet, ingressCredentials, [request]) as
    | IngressCredentials
    | undefined;
  return credentials === undefined ? readNativeHeader(request, name) : credentials[name];
}

/**
 * Carry the ingress credentials of `source` to a replacement request built by
 * framework code, so the copy reads the same values. A source that was never
 * sealed leaves the target reading its own headers.
 */
export function inheritIngressCredentials<T extends Request>(source: Request, target: T): T {
  if (source === target) return target;
  const credentials = IntrinsicReflectApply(WeakMapGet, ingressCredentials, [source]) as
    | IngressCredentials
    | undefined;
  if (credentials === undefined) {
    IntrinsicReflectApply(WeakMapDelete, ingressCredentials, [target]);
  } else {
    IntrinsicReflectApply(WeakMapSet, ingressCredentials, [target, credentials]);
  }
  return target;
}
