/**
 * Dependency-free Node/Bun HTTP transport that connects only to DNS addresses
 * already validated by the host egress policy while preserving the original
 * Host header and TLS SNI name.
 */

import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import * as nodeHttp from "node:http";
import * as nodeHttps from "node:https";
import * as nodeNet from "node:net";
import * as nodeTls from "node:tls";
import type { Readable } from "node:stream";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import { isErrorAcrossRealms } from "../error-introspection.ts";
import {
  assertNativeRequestProcessing,
  assertObjectPrototypeUnchanged,
  copyNativeHeaders,
  createNativeRequestInit,
  descriptorField,
  readOwnInitField,
  readSeparateSetCookies,
  toNativeHeaderRecord,
} from "./native-request-init.ts";

const NULL_BODY_STATUSES = new Set([204, 205, 304]);
// The outgoing headers carry the caller's credentials, so they are only ever
// touched through methods captured before project code could replace them.
const IntrinsicReflectApply = Reflect.apply;
const NativeRequest = Request;
const HeadersHas = Headers.prototype.has;
const HeadersSet = Headers.prototype.set;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!
  .get!;
const RequestArrayBuffer = NativeRequest.prototype.arrayBuffer;
const ReflectGetPrototypeOf = Reflect.getPrototypeOf;
const ReflectOwnKeys = Reflect.ownKeys;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const URLHrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, "href")!.get!;
const FunctionHasInstance = Function.prototype[Symbol.hasInstance];
const NativeURLSearchParams = URLSearchParams;
const NativeBlob = Blob;
const NativeFormData = typeof FormData === "undefined" ? undefined : FormData;
const BlobTypeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, "type")!.get!;

type NodeRequestFunction = typeof import("node:http").request;

/**
 * `node:http` and `node:https` `request`, copied into constants while this
 * module evaluates. Static imports evaluate before any module that imports
 * this one, project code included, and the copies do not follow later
 * changes to the live bindings (`syncBuiltinESMExports`): the function
 * receives the options and their credential-bearing headers.
 *
 * This assumes the host is the process entry and loads this module while the
 * framework starts, before any project module, as hosted runtimes do. A
 * project that is itself the process entry and evaluates first owns the
 * process; keeping credentials out of such a process is the out-of-isolate
 * hop, not something this module can attest.
 */
const capturedHttpRequest: NodeRequestFunction = nodeHttp.request;
const capturedHttpsRequest: NodeRequestFunction = nodeHttps.request;

function nodeRequestFor(protocol: string): NodeRequestFunction {
  return protocol === "https:" ? capturedHttpsRequest : capturedHttpRequest;
}

/**
 * Module-private agents with the global agents' options, copied at load. The global agents
 * are reachable as `http.globalAgent`, and node:http calls `addRequest` on
 * the agent with the request, and its headers, as an argument; an own
 * property added to a shared agent would get it.
 */
// `options` is a runtime field node:http's typings do not declare.
function copyAgentOptions(agent: nodeHttp.Agent): nodeHttp.AgentOptions | undefined {
  const options: unknown = Reflect.get(agent, "options");
  if (typeof options !== "object" || options === null) return undefined;
  return { ...options };
}
const privateHttpAgent = new nodeHttp.Agent(copyAgentOptions(nodeHttp.globalAgent));
const privateHttpsAgent = new nodeHttps.Agent(copyAgentOptions(nodeHttps.globalAgent));

interface MemberSnapshot {
  readonly target: object;
  readonly prototype: object | null;
  readonly keys: readonly PropertyKey[];
  readonly descriptors: readonly (PropertyDescriptor | undefined)[];
}

/**
 * Every prototype node:http calls into while it builds and sends a request:
 * `setHeader`, `getHeader`, `_storeHeader`, `_send`, `end`, `emit` and the
 * rest run with the request as `this` or as an argument, and the request
 * holds the credential-bearing headers. Snapshotted as this module loads,
 * down to (not including) Object.prototype, which has its own check.
 */
const NODE_REQUEST_MEMBERS: readonly MemberSnapshot[] = (() => {
  const snapshots: MemberSnapshot[] = [];
  const seen: object[] = [];
  const addChain = (start: ReturnType<typeof ReflectGetPrototypeOf>) => {
    for (
      let target = start;
      target !== null && target !== Object.prototype && !seen.includes(target);
      target = ReflectGetPrototypeOf(target)
    ) {
      seen.push(target);
      const keys = ReflectOwnKeys(target);
      snapshots.push({
        target,
        prototype: ReflectGetPrototypeOf(target),
        keys,
        descriptors: keys.map((key) => ObjectGetOwnPropertyDescriptor(target!, key)),
      });
    }
  };
  addChain(nodeHttp.ClientRequest.prototype);
  // The response's `req` is the request, so its members reach the headers too.
  addChain(nodeHttp.IncomingMessage.prototype);
  // The serialized header block, bearer included, is written to the socket.
  addChain(nodeTls.TLSSocket.prototype);
  addChain(nodeNet.Socket.prototype);
  addChain(nodeHttps.Agent.prototype);
  addChain(nodeHttp.Agent.prototype);
  addChain(privateHttpAgent);
  addChain(privateHttpsAgent);
  return Object.freeze(snapshots);
})();

function isSameMember(
  current: PropertyDescriptor | undefined,
  original: PropertyDescriptor | undefined,
): boolean {
  if (current === undefined || original === undefined) return current === original;
  const originalValue = descriptorField(original, "value");
  // Data members of the agents (socket maps, counters) change as they work;
  // only functions and accessors are compared. Fields are read as own
  // properties: an inherited `get` on Object.prototype would otherwise run.
  if (typeof originalValue !== "function" && hasOwnField(original, "value")) {
    return hasOwnField(current, "value") &&
      typeof descriptorField(current, "value") !== "function";
  }
  return descriptorField(current, "value") === originalValue &&
    descriptorField(current, "get") === descriptorField(original, "get") &&
    descriptorField(current, "set") === descriptorField(original, "set");
}

function hasOwnField(descriptor: PropertyDescriptor, field: "value"): boolean {
  return IntrinsicReflectApply(ObjectHasOwn, undefined, [descriptor, field]) as boolean;
}

function isFunctionOrAccessor(descriptor: PropertyDescriptor | undefined): boolean {
  if (descriptor === undefined) return false;
  return typeof descriptorField(descriptor, "value") === "function" ||
    descriptorField(descriptor, "get") !== undefined ||
    descriptorField(descriptor, "set") !== undefined;
}

/**
 * Refuse a credential-bearing node:http request once project code replaced,
 * added or removed a member on the request or agent prototypes, or spliced
 * an object into their chains. node:http calls these live, so a replacement
 * would receive the request and its headers.
 */
export function assertNodeRequestMembersUnchanged(): void {
  for (let index = 0; index < NODE_REQUEST_MEMBERS.length; index++) {
    const snapshot = NODE_REQUEST_MEMBERS[index]!;
    let changed = ReflectGetPrototypeOf(snapshot.target) !== snapshot.prototype;
    const keys = ReflectOwnKeys(snapshot.target);
    let member = "its prototype";
    for (let key = 0; !changed && key < keys.length; key++) {
      // A loop, not indexOf: Array.prototype methods are project-replaceable.
      let position = -1;
      for (let known = 0; known < snapshot.keys.length; known++) {
        if (snapshot.keys[known] === keys[key]) {
          position = known;
          break;
        }
      }
      const original = position === -1 ? undefined : snapshot.descriptors[position];
      const current = ObjectGetOwnPropertyDescriptor(snapshot.target, keys[key]!);
      if (
        position === -1 ? isFunctionOrAccessor(current) : !isSameMember(current, original)
      ) {
        changed = true;
        member = String(keys[key]);
      }
    }
    for (let key = 0; !changed && key < snapshot.keys.length; key++) {
      if (
        isFunctionOrAccessor(snapshot.descriptors[key]) &&
        ObjectGetOwnPropertyDescriptor(snapshot.target, snapshot.keys[key]!) === undefined
      ) {
        changed = true;
        member = String(snapshot.keys[key]);
      }
    }
    if (changed) {
      throw new TypeError(
        `Refused a credential-bearing request to protect its token: the node:http member ${member} ` +
          "was replaced, added or removed after load, and node:http calls it with the request " +
          "headers in reach. Do not patch node:http, node:net, node:tls, streams or EventEmitter.",
      );
    }
  }
}

function isInstance(value: unknown, constructor: unknown): boolean {
  return IntrinsicReflectApply(FunctionHasInstance, constructor, [value]) as boolean;
}
const ObjectAssign = Object.assign;
const ObjectCreate = Object.create;

function hasHeader(headers: Headers, name: string): boolean {
  return IntrinsicReflectApply(HeadersHas, headers, [name]) as boolean;
}

function setHeader(headers: Headers, name: string, value: string): void {
  IntrinsicReflectApply(HeadersSet, headers, [name, value]);
}

/**
 * Client identity for guarded egress, standing in for the runtime-supplied
 * `user-agent` (`node`, `Deno/x.y.z`) that this transport cannot inherit.
 */
export const DEFAULT_OUTBOUND_USER_AGENT = `veryfront/${VERSION}`;

export interface PinnedFetchTlsOptions {
  /**
   * Complete trusted CA set for this connection. Passing this replaces the
   * runtime default store, so callers that add a private CA must include the
   * runtime roots too.
   */
  readonly trustedCaCertificates?: readonly string[];
}

/** What the runtime advertises when it is willing to decode a compressed body. */
const DEFAULT_ACCEPT_ENCODING = "gzip, deflate";

/**
 * Fill in the request headers a plain `fetch` attaches on its own, leaving any
 * the caller set untouched. This transport talks to `node:http` directly, so
 * nothing supplies them and requests leave measurably thinner than the same
 * call made through `fetch` — hosts behind a WAF reject user-agent-less
 * requests outright, and omitting `accept-encoding` silently gives up response
 * compression this transport already knows how to decode.
 *
 * Values mirror what Node's `fetch` sends, including the two that are derived
 * rather than fixed: `sec-fetch-mode` follows the request mode, and
 * `accept-encoding` becomes `identity` for range requests. Exact strings need
 * not track the runtime version by version — `pinned-fetch.test.ts` asserts
 * only that no header the runtime sends goes missing, so a runtime that adds
 * one fails loudly rather than drifting.
 *
 * `user-agent` is the deliberate exception: the runtime default (`node`,
 * `Deno/x.y.z`) cannot be inherited here and identifies nothing useful, so
 * guarded egress sends DEFAULT_OUTBOUND_USER_AGENT instead. Parity for that
 * header means "present", not "identical".
 *
 * Split out from the transport so that parity check can run on every runtime:
 * the transport itself is Node/Bun-only, and a test gated on that never
 * executes in the Deno-only CI lanes.
 *
 * @internal
 */
export function applyRuntimeDefaultRequestHeaders(
  headers: Headers,
  mode?: RequestMode,
): Headers {
  if (!hasHeader(headers, "accept")) setHeader(headers, "accept", "*/*");
  if (!hasHeader(headers, "accept-language")) setHeader(headers, "accept-language", "*");
  if (!hasHeader(headers, "accept-encoding")) {
    // A compressed byte range is ambiguous to decode, so the runtime asks for
    // `identity` whenever the caller requested a range.
    setHeader(
      headers,
      "accept-encoding",
      hasHeader(headers, "range") ? "identity" : DEFAULT_ACCEPT_ENCODING,
    );
  }
  // Fetch metadata reports the request mode; it is not always `cors`.
  if (!hasHeader(headers, "sec-fetch-mode")) setHeader(headers, "sec-fetch-mode", mode ?? "cors");
  if (!hasHeader(headers, "user-agent")) {
    setHeader(headers, "user-agent", DEFAULT_OUTBOUND_USER_AGENT);
  }
  return headers;
}

/** @internal Construct a Fetch response without violating null-body statuses. */
export function createPinnedFetchResponse(
  status: number,
  statusText: string,
  headers: Headers,
  body: BodyInit | null,
  requestMethod = "GET",
): Response {
  const responseBody = requestMethod.toUpperCase() === "HEAD" || NULL_BODY_STATUSES.has(status)
    ? null
    : body;
  return new Response(responseBody, {
    status,
    statusText,
    headers,
  });
}

function addressFamily(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/** Connect-level failures that mean "this address is unusable", not "this request is bad". */
const RETRIABLE_CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "ETIMEDOUT",
]);

/**
 * Order the validated addresses into connection attempts.
 *
 * Each attempt dials exactly one validated address, so the walk happens here
 * rather than depending on the runtime: Node honours `autoSelectFamily` and a
 * custom `lookup`, Bun honours neither. A different family is tried before a
 * sibling of the one that just failed, because a host with no IPv6 route fails
 * on every AAAA record its DNS carries.
 *
 * Every address is already validated by the egress policy, so trying them in
 * turn narrows nothing: the set is identical, only the order of use changes.
 */
export function planPinnedConnectAttempts(
  addresses: readonly string[],
): readonly (readonly string[])[] {
  if (addresses.length <= 1) return addresses.map((address) => [address]);
  const first = addresses[0]!;
  const otherFamily = addresses.filter((address) =>
    addressFamily(address) !== addressFamily(first)
  );
  const sameFamily = addresses.slice(1).filter((address) =>
    addressFamily(address) === addressFamily(first)
  );
  return [[first], ...[...otherFamily, ...sameFamily].map((address) => [address])];
}

/** True when the request may be issued again against a different address. */
export function isRetriableConnectFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !RETRIABLE_CONNECT_CODES.has(code)) return false;
  // ETIMEDOUT is the one code here that is not exclusively a connect failure:
  // it also surfaces when a socket times out after the request was written, and
  // replaying then could deliver a non-idempotent request twice. Only the
  // connect syscall is known to have reached no server.
  if (code === "ETIMEDOUT") {
    return (error as { syscall?: unknown }).syscall === "connect";
  }
  return true;
}

/**
 * A body may only be replayed when re-reading it yields the same bytes. A
 * ReadableStream does not qualify: the failed attempt already drained it, so a
 * retry would send nothing.
 */
export function isReplayableRequestBody(body: BodyInit | null): boolean {
  // A Blob counts: it is immutable and `prepareRequestPayload` calls `body.stream()`
  // per attempt, so each attempt gets a fresh stream over identical bytes. A
  // ReadableStream does not, because the attempt that failed already drained it.
  return body === null || typeof body === "string" ||
    body instanceof URLSearchParams || body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) || body instanceof Blob;
}

function copyResponseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    const name = message.rawHeaders[i];
    const value = message.rawHeaders[i + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

async function normalizeRequestBody(
  url: URL,
  init: RequestInit,
  headers: Headers,
): Promise<BodyInit | null> {
  // The body's kind and type are read first, through captured primitives
  // (a constructor's own Symbol.hasInstance is never consulted); a proxy body
  // can still run code here, so the headers are checked after these reads and
  // before the first header operation.
  const body = readOwnInitField(init, "body") ?? null;
  const isSearchParams = isInstance(body, NativeURLSearchParams);
  const isBlob = !isSearchParams && isInstance(body, NativeBlob);
  const blobType = isBlob ? IntrinsicReflectApply(BlobTypeGetter, body, []) as string : "";
  const isFormData = !isSearchParams && !isBlob && NativeFormData !== undefined &&
    isInstance(body, NativeFormData);
  assertNativeRequestProcessing();
  if (isSearchParams && !hasHeader(headers, "content-type")) {
    setHeader(headers, "content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (isBlob && blobType && !hasHeader(headers, "content-type")) {
    setHeader(headers, "content-type", blobType);
  } else if (isFormData) {
    // A string, read with the captured getter: converting a URL object would
    // call a patchable toString inside the constructor.
    const href = IntrinsicReflectApply(URLHrefGetter, url, []) as string;
    const method = readOwnInitField(init, "method") ?? "POST";
    // The instanceof checks above and the method read can run project code,
    // and the constructor calls Headers members with these headers as `this`
    // while it adds the multipart content type: check right before it.
    assertNativeRequestProcessing();
    const normalized = new NativeRequest(
      href,
      createNativeRequestInit(undefined, { method, headers, body }),
    );
    const normalizedHeaders = toNativeHeaderRecord(
      IntrinsicReflectApply(RequestHeadersGetter, normalized, []) as Headers,
    );
    // The multipart encoder adds only the content type, with its boundary.
    const contentType = normalizedHeaders["content-type"];
    if (contentType !== undefined) setHeader(headers, "content-type", contentType);
    return new Uint8Array(
      await (IntrinsicReflectApply(RequestArrayBuffer, normalized, []) as Promise<ArrayBuffer>),
    );
  }
  return body;
}

type RequestPayload =
  | { readonly kind: "chunk"; readonly chunk: string | Uint8Array | undefined }
  | { readonly kind: "stream"; readonly source: Readable };

/**
 * The request body in the form node:http writes, prepared before the request
 * exists: preparing it can run project code (a `toString`, typed-array getters,
 * a Blob's `stream`), which must not run while a request holds the headers.
 */
async function prepareRequestPayload(body: BodyInit | null): Promise<RequestPayload> {
  if (body === null) return { kind: "chunk", chunk: undefined };
  if (typeof body === "string" || body instanceof URLSearchParams) {
    return { kind: "chunk", chunk: String(body) };
  }
  if (body instanceof ArrayBuffer) return { kind: "chunk", chunk: new Uint8Array(body) };
  if (ArrayBuffer.isView(body)) {
    return {
      kind: "chunk",
      chunk: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    };
  }
  const { Readable } = await import("node:stream");
  const webStream = body instanceof Blob ? body.stream() : body;
  return {
    kind: "stream",
    source: Readable.fromWeb(webStream as import("node:stream/web").ReadableStream<Uint8Array>),
  };
}

/** Write a prepared payload; a chunk is written in the caller's turn. */
function writeRequestPayload(request: ClientRequest, payload: RequestPayload): Promise<void> {
  if (payload.kind === "chunk") {
    if (payload.chunk === undefined) request.end();
    else request.end(payload.chunk);
    return Promise.resolve();
  }
  const source = payload.source;
  return new Promise<void>((resolve, reject) => {
    source.once("error", reject);
    request.once("error", reject);
    request.once("finish", resolve);
    source.pipe(request);
  });
}

async function decodeResponseBody(
  response: IncomingMessage,
  headers: Headers,
): Promise<Readable> {
  const encoding = headers.get("content-encoding")?.trim().toLowerCase();
  if (!encoding || encoding === "identity") return response;

  const zlib = await import("node:zlib");
  let decoder:
    | ReturnType<typeof zlib.createGunzip>
    | ReturnType<typeof zlib.createInflate>
    | ReturnType<typeof zlib.createBrotliDecompress>;
  if (encoding === "gzip" || encoding === "x-gzip") {
    decoder = zlib.createGunzip();
  } else if (encoding === "deflate") {
    decoder = zlib.createInflate();
  } else if (encoding === "br") {
    decoder = zlib.createBrotliDecompress();
  } else {
    return response;
  }
  headers.delete("content-encoding");
  headers.delete("content-length");
  return response.pipe(decoder);
}

/** @internal Used by the central egress guard after DNS policy validation. */
export async function fetchWithPinnedAddresses(
  url: URL,
  addresses: readonly string[],
  init: RequestInit,
  tls: PinnedFetchTlsOptions = {},
): Promise<Response> {
  if (addresses.length === 0) {
    throw new Error(`No validated addresses are available for ${url.host}`);
  }
  // Filling and reading a native Headers writes into arrays an index accessor
  // or a replaced array species would observe; each turn that touches the
  // credential-bearing headers is checked first.
  // Init fields first: an own getter runs project code, which must not run
  // once the credential-bearing headers exist.
  const mode = readOwnInitField(init, "mode");
  const initHeaders = readOwnInitField(init, "headers");
  assertNativeRequestProcessing();
  const headers = applyRuntimeDefaultRequestHeaders(copyNativeHeaders(initHeaders), mode);
  const body = await normalizeRequestBody(url, init, headers);
  const method = (readOwnInitField(init, "method") ?? "GET").toUpperCase();
  assertNativeRequestProcessing();
  const requestHeaders = toNativeHeaderRecord(headers);
  const setCookies = readSeparateSetCookies(requestHeaders);
  const signal = readOwnInitField(init, "signal") ?? undefined;

  const sendRequest = nodeRequestFor(url.protocol);
  const attempts = planPinnedConnectAttempts(addresses);
  const bodyIsReplayable = isReplayableRequestBody(body);
  let lastConnectError: unknown;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    // Null-prototype options and headers: whatever node:http reads from them
    // directly never falls through to Object.prototype. It reads most options
    // from its own ordinary copy, though, which assertObjectPrototypeUnchanged
    // covers before the call.
    const outgoingHeaders = ObjectAssign(ObjectCreate(null), requestHeaders, {
      // node:http sends each element of an array value as its own field.
      ...(setCookies === undefined ? {} : { "set-cookie": [...setCookies] }),
      host: url.host,
    }) as Record<string, string | string[]>;
    const requestOptions: RequestOptions & {
      autoSelectFamily?: boolean;
      ca?: string[];
    } = ObjectAssign(ObjectCreate(null), {
      protocol: url.protocol,
      // Connect straight to the validated address. Overriding DNS through a
      // custom `lookup` is the documented way to pin and Node honours it, but
      // Bun's node:https ignores the address it returns and fails with
      // ECONNREFUSED even for a reachable one, so the pin was inert there.
      // Dialling the address directly needs no runtime cooperation; identity
      // travels in the Host header and the TLS SNI name instead.
      hostname: attempts[attemptIndex]![0]!,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: outgoingHeaders,
      agent: url.protocol === "https:" ? privateHttpsAgent : privateHttpAgent,

      ...(url.protocol === "https:"
        ? {
          servername: url.hostname,
          ...(tls.trustedCaCertificates?.length ? { ca: [...tls.trustedCaCertificates] } : {}),
        }
        : {}),
    });

    // Prepared before the request exists: it can run project code.
    const payload = await prepareRequestPayload(body);
    let pendingRequest: ClientRequest | undefined;
    try {
      return await new Promise<Response>((resolve, reject) => {
        let settled = false;
        let responseMessage: IncomingMessage | undefined;
        const abortReason = () =>
          signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
        const abort = () => {
          const reason = abortReason();
          responseMessage?.destroy(isErrorAcrossRealms(reason) ? reason : undefined);
          // Registered before the request exists; it only fires afterwards.
          request.destroy(isErrorAcrossRealms(reason) ? reason : undefined);
          if (!settled) rejectBeforeResponse(reason);
        };
        const cleanupAbortListener = () => signal?.removeEventListener("abort", abort);
        const rejectBeforeResponse = (error: unknown) => {
          cleanupAbortListener();
          reject(error);
        };
        // The signal's members can run project code, so they are used before
        // the request, and its headers, exist.
        if (signal?.aborted) {
          reject(abortReason());
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        // Same turn as the call and every request operation below: node:http
        // processes the headers synchronously, and nothing between here and
        // the body write runs project code.
        assertNativeRequestProcessing();
        assertObjectPrototypeUnchanged();
        assertNodeRequestMembersUnchanged();
        const request = sendRequest(requestOptions, async (message) => {
          responseMessage = message;
          try {
            // The response's `req` is the request: checked again before any
            // member of either runs in this turn.
            assertNodeRequestMembersUnchanged();
            const responseHeaders = copyResponseHeaders(message);
            const status = message.statusCode ?? 500;
            if (method === "HEAD" || NULL_BODY_STATUSES.has(status)) {
              message.once("end", cleanupAbortListener);
              message.once("close", cleanupAbortListener);
              message.once("error", cleanupAbortListener);
              // Drain any protocol-invalid payload without exposing it through the
              // Fetch response. Response rejects stream bodies for these statuses.
              message.resume();
              settled = true;
              resolve(createPinnedFetchResponse(
                status,
                message.statusMessage ?? "",
                responseHeaders,
                null,
                method,
              ));
              return;
            }
            const decoded = await decodeResponseBody(message, responseHeaders);
            decoded.once("end", cleanupAbortListener);
            decoded.once("close", cleanupAbortListener);
            decoded.once("error", cleanupAbortListener);
            const { Readable } = await import("node:stream");
            const webBody = Readable.toWeb(decoded) as globalThis.ReadableStream<Uint8Array>;
            settled = true;
            resolve(createPinnedFetchResponse(
              status,
              message.statusMessage ?? "",
              responseHeaders,
              webBody,
              method,
            ));
          } catch (error) {
            rejectBeforeResponse(error);
          }
        });

        // node:http writes the header block once a socket is assigned, a later
        // turn than the check above: check again when the socket arrives, and
        // destroy the request before anything is written if a member changed.
        request.once("socket", () => {
          try {
            assertNodeRequestMembersUnchanged();
          } catch (error) {
            request.destroy(isErrorAcrossRealms(error) ? error : undefined);
          }
        });
        request.once("error", rejectBeforeResponse);
        // Bun reports connect failures through
        // `process.nextTick(() => self.emit("error", err))`, so the emit can
        // land after this promise has settled and after the `once` listener
        // above has been consumed. With no listener left, Node stream
        // semantics turn it into an uncaught exception and the process exits,
        // which is how one refused address took down the dev server instead of
        // failing a single request. This sink absorbs the late emit; the first
        // error still rejects through `rejectBeforeResponse`.
        request.on("error", () => {});
        pendingRequest = request;
        void writeRequestPayload(request, payload).catch((error) => request.destroy(error));
      });
    } catch (error) {
      // Release the socket of the attempt being abandoned. The sink above stays
      // attached, so a teardown error from this destroy has somewhere to land.
      pendingRequest?.destroy();
      lastConnectError = error;
      const hasAnotherAddress = attemptIndex < attempts.length - 1;
      if (
        !hasAnotherAddress || !bodyIsReplayable || signal?.aborted ||
        !isRetriableConnectFailure(error)
      ) {
        throw error;
      }
    }
  }

  throw lastConnectError;
}
