/**
 * Run credentials taken off an inbound request before framework code reads it.
 *
 * The proxy's `x-token` and the control plane's inference, run-event and stop-acknowledgement
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
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HeadersGet = NativeHeaders.prototype.get;
const HeadersAppend = NativeHeaders.prototype.append;
const HeadersDelete = NativeHeaders.prototype.delete;
const HeadersEntries = NativeHeaders.prototype.entries;
const HeadersIteratorNext = Object.getPrototypeOf(new NativeHeaders().entries()).next as (
  this: IterableIterator<[string, string]>,
) => IteratorResult<[string, string]>;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!
  .get!;
const StringToLowerCase = String.prototype.toLowerCase;
const StringStartsWith = String.prototype.startsWith;
const StringIndexOf = String.prototype.indexOf;
const StringSlice = String.prototype.slice;
const StringToUpperCase = String.prototype.toUpperCase;
const RequestMethodGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "method")!
  .get!;
const NativeURL = URL;
const RequestUrlGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "url")!.get!;
const URLPathnameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")!.get!;
const WeakMapDelete = NativeWeakMap.prototype.delete;
const WeakMapGet = NativeWeakMap.prototype.get;
const WeakMapHas = NativeWeakMap.prototype.has;
const WeakMapSet = NativeWeakMap.prototype.set;
const NativeTypeError = TypeError;
const FunctionHasInstance = Function.prototype[Symbol.hasInstance];

/** The proxy-injected Veryfront API credential. */
export const INGRESS_API_TOKEN_HEADER = "x-token";
/** The control plane's gateway-only inference credential. */
export const INGRESS_INFERENCE_TOKEN_HEADER = "x-veryfront-inference-token";
/** The control plane's exact-run durable event append credential. */
export const INGRESS_RUN_EVENT_TOKEN_HEADER = "x-veryfront-run-event-token";
/** The control plane's exact-run cancellation acknowledgement credential. */
export const INGRESS_RUN_STOP_TOKEN_HEADER = "x-veryfront-run-stop-token";
/** The control plane's exact-run, generation-fenced finalize credential. */
export const INGRESS_RUN_TERMINAL_TOKEN_HEADER = "x-veryfront-run-terminal-token";
/**
 * `Authorization`, taken off only on control-plane run routes, where the
 * control plane sends the same service-account token as in `x-token`.
 * Application routes keep it: tenant apps authenticate their own users with it.
 */
export const INGRESS_AUTHORIZATION_HEADER = "authorization";
/**
 * The control-plane run route prefix. The same value as
 * `CONTROL_PLANE_RUNS_PATH_PREFIX`, which a test pins; importing it here would
 * pull the control-plane schemas into every ingress.
 */
export const INGRESS_RUN_ROUTE_PREFIX = "/api/control-plane/runs/";

export type IngressCredentialHeader =
  | typeof INGRESS_API_TOKEN_HEADER
  | typeof INGRESS_INFERENCE_TOKEN_HEADER
  | typeof INGRESS_RUN_EVENT_TOKEN_HEADER
  | typeof INGRESS_RUN_STOP_TOKEN_HEADER
  | typeof INGRESS_RUN_TERMINAL_TOKEN_HEADER
  | typeof INGRESS_AUTHORIZATION_HEADER;

type IngressCredentials = { readonly [name in IngressCredentialHeader]: string | null };

const ingressCredentials = new NativeWeakMap<Request, IngressCredentials>();
// Sealed WebSocket upgrade -> the original server request, for the upgrade only.
const upgradeSources = new NativeWeakMap<Request, Request>();

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
interface HeadersWithoutCredentials {
  /** Every header but the credentials and `set-cookie`, one value per name. */
  readonly record: Record<string, string>;
  /** The `set-cookie` values, each its own field; joining them would corrupt them. */
  readonly setCookies: string[];
}

/**
 * True only for the registered control-plane run routes:
 * `POST /api/control-plane/runs/{runId}/execute|stream|resume` and
 * `DELETE /api/control-plane/runs/{runId}`, the run shapes
 * `isControlPlaneSurfaceRoute` admits (a test pins the two together). Any
 * other path under the prefix falls through to project code, which keeps its
 * `Authorization`. Parsed with captured string methods rather than a RegExp,
 * whose `exec` project code could replace to make a run route not match.
 */
export function isControlPlaneRunRoute(method: string, pathname: string): boolean {
  if (
    !(IntrinsicReflectApply(StringStartsWith, pathname, [INGRESS_RUN_ROUTE_PREFIX]) as boolean)
  ) return false;
  const rest = IntrinsicReflectApply(StringSlice, pathname, [
    INGRESS_RUN_ROUTE_PREFIX.length,
  ]) as string;
  const slash = IntrinsicReflectApply(StringIndexOf, rest, ["/"]) as number;
  if (slash === 0 || rest.length === 0) return false;
  const operation = slash === -1 ? "" : IntrinsicReflectApply(StringSlice, rest, [slash]) as string;
  const upperMethod = IntrinsicReflectApply(StringToUpperCase, method, []) as string;
  if (upperMethod === "DELETE") return operation === "";
  if (upperMethod !== "POST") return false;
  return operation === "/execute" || operation === "/stream" || operation === "/resume";
}

function isRunRoute(request: Request): boolean {
  const url = new NativeURL(IntrinsicReflectApply(RequestUrlGetter, request, []) as string);
  return isControlPlaneRunRoute(
    IntrinsicReflectApply(RequestMethodGetter, request, []) as string,
    IntrinsicReflectApply(URLPathnameGetter, url, []) as string,
  );
}

function toHeaderRecordWithoutCredentials(
  request: Request,
  withoutAuthorization: boolean,
): HeadersWithoutCredentials {
  const record = ObjectCreate(null) as Record<string, string>;
  const setCookies: string[] = [];
  const headers = IntrinsicReflectApply(RequestHeadersGetter, request, []) as Headers;
  const iterator = IntrinsicReflectApply(HeadersEntries, headers, []) as IterableIterator<
    [string, string]
  >;
  while (true) {
    const step = IntrinsicReflectApply(HeadersIteratorNext, iterator, []) as IteratorResult<
      [string, string]
    >;
    if (step.done) return { record, setCookies };
    // Entries arrive lowercased, so the names compare without normalising.
    const name = step.value[0];
    if (
      name === INGRESS_API_TOKEN_HEADER || name === INGRESS_INFERENCE_TOKEN_HEADER ||
      name === INGRESS_RUN_EVENT_TOKEN_HEADER || name === INGRESS_RUN_STOP_TOKEN_HEADER ||
      name === INGRESS_RUN_TERMINAL_TOKEN_HEADER ||
      (withoutAuthorization && name === INGRESS_AUTHORIZATION_HEADER)
    ) continue;
    if (name === "set-cookie") {
      // Not a credential, so this list may use ordinary array writes.
      setCookies[setCookies.length] = step.value[1];
      continue;
    }
    // Headers already joins every other repeated name.
    record[name] = step.value[1];
  }
}

/**
 * The request the runtime pipeline should handle: `request` itself when it
 * carries no credential header, otherwise a copy without them that keeps the
 * URL, method, remaining headers, body, signal and transport peer. Either way
 * the credentials stay readable through {@link readIngressCredential}.
 *
 * Deno can upgrade a WebSocket only on the exact Request its server
 * produced, so for an upgrade the original is kept aside and handed out only
 * by {@link requestForWebSocketUpgrade}, for the upgrade call itself.
 */
export function sealIngressCredentials(request: Request): Request {
  // Sealed already (an outer server wrapper ran first), or a framework copy of
  // a sealed request: its headers no longer hold what it arrived with.
  if (IntrinsicReflectApply(WeakMapHas, ingressCredentials, [request])) return request;
  const credentials = readCredentialHeaders(request);
  if (!hasAnyCredential(credentials)) {
    IntrinsicReflectApply(WeakMapSet, ingressCredentials, [request, credentials]);
    return request;
  }
  return sealWith(request, credentials);
}

function readCredentialHeaders(request: Request): IngressCredentials {
  return ObjectFreeze({
    __proto__: null,
    [INGRESS_AUTHORIZATION_HEADER]: isRunRoute(request)
      ? readNativeHeader(request, INGRESS_AUTHORIZATION_HEADER)
      : null,
    [INGRESS_API_TOKEN_HEADER]: readNativeHeader(request, INGRESS_API_TOKEN_HEADER),
    [INGRESS_INFERENCE_TOKEN_HEADER]: readNativeHeader(request, INGRESS_INFERENCE_TOKEN_HEADER),
    [INGRESS_RUN_EVENT_TOKEN_HEADER]: readNativeHeader(request, INGRESS_RUN_EVENT_TOKEN_HEADER),
    [INGRESS_RUN_STOP_TOKEN_HEADER]: readNativeHeader(request, INGRESS_RUN_STOP_TOKEN_HEADER),
    [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: readNativeHeader(
      request,
      INGRESS_RUN_TERMINAL_TOKEN_HEADER,
    ),
  } as IngressCredentials);
}

function hasAnyCredential(credentials: IngressCredentials): boolean {
  return credentials[INGRESS_API_TOKEN_HEADER] !== null ||
    credentials[INGRESS_INFERENCE_TOKEN_HEADER] !== null ||
    credentials[INGRESS_RUN_EVENT_TOKEN_HEADER] !== null ||
    credentials[INGRESS_RUN_STOP_TOKEN_HEADER] !== null ||
    credentials[INGRESS_RUN_TERMINAL_TOKEN_HEADER] !== null ||
    credentials[INGRESS_AUTHORIZATION_HEADER] !== null;
}

function deleteCredentialHeaders(headers: Headers, withoutAuthorization: boolean): void {
  IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_API_TOKEN_HEADER]);
  IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_INFERENCE_TOKEN_HEADER]);
  IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_RUN_EVENT_TOKEN_HEADER]);
  IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_RUN_STOP_TOKEN_HEADER]);
  IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_RUN_TERMINAL_TOKEN_HEADER]);
  if (withoutAuthorization) {
    IntrinsicReflectApply(HeadersDelete, headers, [INGRESS_AUTHORIZATION_HEADER]);
  }
}

/** A copy of `request` without the credential headers, holding `credentials`. */
function sealWith(request: Request, credentials: IngressCredentials): Request {
  assertNativeHeaderProcessing();
  assertNativeRequestDefaults();
  // Null prototype: the constructor reads `body`, `method`, `signal` and the
  // other init fields by name, and an inherited getter would see `headers`.
  const init = ObjectCreate(null) as RequestInit;
  const withoutAuthorization = credentials[INGRESS_AUTHORIZATION_HEADER] !== null;
  const remaining = toHeaderRecordWithoutCredentials(request, withoutAuthorization);
  init.headers = remaining.record;
  const sealed = new NativeRequest(request, init);
  // Bun can retain the source headers when the override record is empty.
  // Scrub only the private copy, through captured methods, before publishing it.
  const sealedHeaders = IntrinsicReflectApply(RequestHeadersGetter, sealed, []) as Headers;
  deleteCredentialHeaders(sealedHeaders, withoutAuthorization);
  // Clear any cookies retained by the constructor before replaying each field.
  IntrinsicReflectApply(HeadersDelete, sealedHeaders, ["set-cookie"]);
  if (remaining.setCookies.length > 0) {
    // Appended one by one so each stays its own field. The copy holds no
    // credential and is not yet reachable by project code.
    for (let index = 0; index < remaining.setCookies.length; index++) {
      IntrinsicReflectApply(HeadersAppend, sealedHeaders, [
        "set-cookie",
        remaining.setCookies[index],
      ]);
    }
  }
  IntrinsicReflectApply(WeakMapSet, ingressCredentials, [sealed, credentials]);
  // A request sealed before keeps pointing at its original server request.
  const upgradeSource = IntrinsicReflectApply(WeakMapGet, upgradeSources, [request]) as
    | Request
    | undefined;
  if (upgradeSource !== undefined || isWebSocketUpgrade(request)) {
    IntrinsicReflectApply(WeakMapSet, upgradeSources, [sealed, upgradeSource ?? request]);
  }
  return inheritRequestPeerProvenance(request, sealed);
}

/**
 * The request to pass to the WebSocket upgrade call: the original server
 * request behind a sealed upgrade, otherwise `request` itself. Deno's upgrade
 * reads the original's headers through `Request.prototype.headers` and
 * `Headers.prototype.get`, with the credentials still on it, so it is refused
 * once project code has replaced either.
 */
export function requestForWebSocketUpgrade(request: Request): Request {
  const source = IntrinsicReflectApply(WeakMapGet, upgradeSources, [request]) as
    | Request
    | undefined;
  if (source === undefined) return request;
  if (
    ObjectGetOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get !==
      RequestHeadersGetter ||
    ObjectGetOwnPropertyDescriptor(NativeHeaders.prototype, "get")?.value !== HeadersGet
  ) {
    throw new TypeError("Cannot upgrade a credential-bearing request with modified headers");
  }
  return source;
}

/**
 * Seal the request a caller-owned interceptor (the in-process proxy of
 * combined mode) produced from the sealed `source`. A credential the
 * interceptor writes wins; any it does not write carries over from `source`,
 * since the interceptor no longer sees them in the headers it would have
 * forwarded.
 */
export function sealInterceptedRequest(source: Request, intercepted: Request): Request {
  const before = IntrinsicReflectApply(WeakMapGet, ingressCredentials, [source]) as
    | IngressCredentials
    | undefined;
  // Read what the interceptor put in the headers, even on a request that was
  // sealed before: one that edits its input in place and returns it would
  // otherwise leave a new token in the headers.
  const written = readCredentialHeaders(intercepted);
  const registered = IntrinsicReflectApply(WeakMapGet, ingressCredentials, [intercepted]) as
    | IngressCredentials
    | undefined;
  let sealed: Request;
  let after: IngressCredentials;
  if (hasAnyCredential(written)) {
    sealed = sealWith(intercepted, written);
    after = written;
    // The interceptor's own request is not passed on, but it may be the
    // sealed source it edited in place, which other framework code still
    // holds: take the credentials it wrote off it too. Immutable headers (a
    // runtime-created request) cannot have been written by the interceptor.
    try {
      deleteCredentialHeaders(
        IntrinsicReflectApply(RequestHeadersGetter, intercepted, []) as Headers,
      );
    } catch (error) {
      // Only the immutable-headers refusal is expected; the sealed copy above
      // is what goes on. Anything else is a real failure.
      if (!IntrinsicReflectApply(FunctionHasInstance, NativeTypeError, [error])) throw error;
    }
  } else if (registered !== undefined) {
    if (intercepted === source) return source;
    sealed = intercepted;
    after = registered;
  } else {
    sealed = sealIngressCredentials(intercepted);
    after = written;
  }
  if (before === undefined) return sealed;
  IntrinsicReflectApply(WeakMapSet, ingressCredentials, [
    sealed,
    ObjectFreeze({
      __proto__: null,
      // The interceptor's own x-token wins; without one, the token the request
      // arrived with stays, as it did when interceptors saw the raw request.
      [INGRESS_API_TOKEN_HEADER]: after[INGRESS_API_TOKEN_HEADER] ??
        before[INGRESS_API_TOKEN_HEADER],
      [INGRESS_INFERENCE_TOKEN_HEADER]: after[INGRESS_INFERENCE_TOKEN_HEADER] ??
        before[INGRESS_INFERENCE_TOKEN_HEADER],
      [INGRESS_RUN_EVENT_TOKEN_HEADER]: after[INGRESS_RUN_EVENT_TOKEN_HEADER] ??
        before[INGRESS_RUN_EVENT_TOKEN_HEADER],
      [INGRESS_RUN_STOP_TOKEN_HEADER]: after[INGRESS_RUN_STOP_TOKEN_HEADER] ??
        before[INGRESS_RUN_STOP_TOKEN_HEADER],
      [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: after[INGRESS_RUN_TERMINAL_TOKEN_HEADER] ??
        before[INGRESS_RUN_TERMINAL_TOKEN_HEADER],
      [INGRESS_AUTHORIZATION_HEADER]: after[INGRESS_AUTHORIZATION_HEADER] ??
        before[INGRESS_AUTHORIZATION_HEADER],
    } as IngressCredentials),
  ]);
  return sealed;
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
  if (credentials === undefined) return readNativeHeader(request, name);
  // Off a run route `Authorization` stays in the headers, so it is read there.
  if (name === INGRESS_AUTHORIZATION_HEADER && credentials[name] === null) {
    return readNativeHeader(request, name);
  }
  return credentials[name];
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
  const upgradeSource = IntrinsicReflectApply(WeakMapGet, upgradeSources, [source]) as
    | Request
    | undefined;
  if (upgradeSource === undefined) {
    IntrinsicReflectApply(WeakMapDelete, upgradeSources, [target]);
  } else {
    IntrinsicReflectApply(WeakMapSet, upgradeSources, [target, upgradeSource]);
  }
  return target;
}
