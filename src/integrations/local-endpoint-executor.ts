import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { guardedEgressFetch } from "#veryfront/security/sandbox/worker-egress-guard.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  LOCAL_INTEGRATION_REQUEST_FAILED,
  LOCAL_INTEGRATION_REQUEST_INVALID,
  LOCAL_INTEGRATION_RESPONSE_INVALID,
} from "./local-integration-errors.ts";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
} from "./limits.ts";
import type { IntegrationToolMeta } from "./schema.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;
type IntegrationEndpointParam = NonNullable<IntegrationEndpoint["params"]>[string];
type IntegrationEndpointBodyField = NonNullable<IntegrationEndpoint["body"]>[string];

const abortControllerAbort = AbortController.prototype.abort;
const AbortControllerConstructor = AbortController;
const abortControllerSignal = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  "signal",
)?.get;
const abortSignalAborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalReason = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "reason",
)?.get;
const addEventListener = EventTarget.prototype.addEventListener;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const clearTimeoutIntrinsic = clearTimeout;
const DOMExceptionConstructor = DOMException;
const encodeUriComponent = encodeURIComponent;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const HeadersConstructor = Headers;
const headersGet = Headers.prototype.get;
const headersSet = Headers.prototype.set;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectKeys = Object.keys;
const removeEventListener = EventTarget.prototype.removeEventListener;
const readableStreamCancel = ReadableStream.prototype.cancel;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")?.get;
const responseHeaders = Object.getOwnPropertyDescriptor(Response.prototype, "headers")?.get;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get;
const promiseCatch = Promise.prototype.catch;
const setTimeoutIntrinsic = setTimeout;
const StringConstructor = String;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIncludes = String.prototype.includes;
const stringReplaceAll = String.prototype.replaceAll;
const stringSlice = String.prototype.slice;
const textEncoder = new TextEncoder();
const textEncoderEncode = TextEncoder.prototype.encode;
const URLConstructor = URL;
const urlOrigin = Object.getOwnPropertyDescriptor(URL.prototype, "origin")?.get;
const urlSearchParams = Object.getOwnPropertyDescriptor(URL.prototype, "searchParams")?.get;
const urlSearchParamsAppend = URLSearchParams.prototype.append;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;

if (
  typeof abortSignalAborted !== "function" ||
  typeof abortSignalReason !== "function" ||
  typeof abortControllerSignal !== "function" ||
  typeof responseBody !== "function" ||
  typeof responseHeaders !== "function" ||
  typeof responseStatus !== "function" ||
  typeof typedArrayByteLength !== "function" ||
  typeof urlOrigin !== "function" ||
  typeof urlSearchParams !== "function"
) {
  throw new TypeError("Local integration HTTP primitives are unavailable");
}

/** A fully constructed request admitted to the local integration transport. */
export interface LocalIntegrationEndpointTransportRequest {
  readonly url: URL;
  readonly init: RequestInit;
  readonly allowedOrigin: string;
}

/** Internal transport seam used to verify request construction without network access. */
export type LocalIntegrationEndpointTransport = (
  request: LocalIntegrationEndpointTransportRequest,
) => Promise<Response>;

export interface ExecuteLocalIntegrationEndpointOptions {
  readonly endpoint: IntegrationEndpoint;
  readonly args: Record<string, unknown>;
  readonly authHeaders: Readonly<Record<string, string>>;
  readonly allowedOrigin: string;
  readonly signal?: AbortSignal;
  /** Internal test seam. Production callers use the standard integration deadline. */
  readonly timeoutMs?: number;
  /** Internal test seam. Production callers use the guarded egress transport. */
  readonly transport?: LocalIntegrationEndpointTransport;
}

export interface ExecuteLocalIntegrationJsonRequestOptions {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly allowedOrigin: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly transport?: LocalIntegrationEndpointTransport;
}

interface RequestSignalLease {
  readonly signal: AbortSignal;
  release(): void;
}

function requestInvalid(detail: string): never {
  throw LOCAL_INTEGRATION_REQUEST_INVALID.create({ detail });
}

function requestFailed(): never {
  throw LOCAL_INTEGRATION_REQUEST_FAILED.create();
}

function responseInvalid(): never {
  throw LOCAL_INTEGRATION_RESPONSE_INVALID.create();
}

function callStringBoolean(
  operation: (this: string, searchString: string, position?: number) => boolean,
  value: string,
  searchString: string,
): boolean {
  return apply(operation, value, [searchString]);
}

function replaceAll(value: string, search: string, replacement: string): string {
  return apply(stringReplaceAll, value, [search, replacement]);
}

function urlValue(getter: ((this: URL) => string) | undefined, value: URL): string {
  if (!getter) requestFailed();
  return apply(getter, value, []);
}

function signalValue<T>(
  getter: ((this: AbortSignal) => T) | undefined,
  signal: AbortSignal,
): T {
  if (!getter) requestFailed();
  return apply(getter, signal, []);
}

function controllerSignalValue(controller: AbortController): AbortSignal {
  if (!abortControllerSignal) requestFailed();
  return apply(abortControllerSignal, controller, []) as AbortSignal;
}

function responseStatusValue(response: Response): number {
  if (!responseStatus) requestFailed();
  return apply(responseStatus, response, []) as number;
}

function responseBodyValue(response: Response): ReadableStream<Uint8Array> | null {
  if (!responseBody) responseInvalid();
  return apply(responseBody, response, []) as ReadableStream<Uint8Array> | null;
}

function responseHeadersValue(response: Response): Headers {
  if (!responseHeaders) responseInvalid();
  return apply(responseHeaders, response, []) as Headers;
}

function charCodeAt(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]);
}

function slice(value: string, start: number, end?: number): string {
  return end === undefined
    ? apply(stringSlice, value, [start])
    : apply(stringSlice, value, [start, end]);
}

function ownValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): { present: boolean; value: unknown } {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!("value" in descriptor)) requestInvalid(`Local integration argument "${key}" is invalid`);
  return { present: true, value: descriptor.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !arrayIsArray(value);
}

function valueMatchesType(
  value: unknown,
  type: IntegrationEndpointParam["type"] | IntegrationEndpointBodyField["type"],
): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && numberIsFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return isRecord(value);
  if (type === "array") return arrayIsArray(value);
  if (type === "string[]") {
    if (!arrayIsArray(value)) return false;
    for (let index = 0; index < value.length; index++) {
      if (typeof value[index] !== "string") return false;
    }
    return true;
  }
  return false;
}

function fieldValue(
  args: Record<string, unknown>,
  name: string,
  field: IntegrationEndpointParam | IntegrationEndpointBodyField,
): { present: boolean; value: unknown } {
  const supplied = ownValue(args, name);
  const value = supplied.present ? supplied.value : field.default;
  const present = supplied.present || field.default !== undefined;
  if (!present) {
    if (field.required === true) {
      requestInvalid(`Local integration argument "${name}" is required`);
    }
    return { present: false, value: undefined };
  }
  if (!valueMatchesType(value, field.type)) {
    requestInvalid(`Local integration argument "${name}" must have type "${field.type}"`);
  }
  return { present: true, value };
}

function scalarString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return StringConstructor(value);
  }
  requestInvalid("Local integration path, query, and header arguments must be scalar values");
}

function appendQueryValue(
  searchParams: URLSearchParams,
  name: string,
  value: unknown,
  field: IntegrationEndpointParam,
): void {
  const append = (item: string): void => {
    const formatted = field.queryValueFormat === "microsoft-graph-search"
      ? `"${replaceAll(item, '"', '\\"')}"`
      : item;
    apply(urlSearchParamsAppend, searchParams, [field.queryName ?? name, formatted]);
  };
  if (arrayIsArray(value)) {
    for (let index = 0; index < value.length; index++) append(value[index]);
    return;
  }
  append(scalarString(value));
}

function setHeader(headers: Headers, name: string, value: string): void {
  try {
    apply(headersSet, headers, [name, value]);
  } catch {
    requestInvalid("Local integration header input is invalid");
  }
}

function snapshotArguments(args: Record<string, unknown>): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(args);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    requestInvalid("Local integration arguments must be a bounded JSON object");
  }
  return snapshot.value;
}

function assertKnownArguments(
  args: Record<string, unknown>,
  endpoint: IntegrationEndpoint,
): void {
  const paramNames = objectKeys(endpoint.params ?? {});
  const bodyNames = objectKeys(endpoint.body ?? {});
  const argumentNames = objectKeys(args);
  for (let argumentIndex = 0; argumentIndex < argumentNames.length; argumentIndex++) {
    const name = argumentNames[argumentIndex]!;
    let known = false;
    for (let index = 0; index < paramNames.length; index++) {
      if (paramNames[index] === name) known = true;
    }
    for (let index = 0; index < bodyNames.length; index++) {
      if (bodyNames[index] === name) known = true;
    }
    if (!known) requestInvalid(`Local integration argument "${name}" is not declared`);
  }
}

function serializeJson(value: unknown): string {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) requestInvalid("Local integration request body must be bounded JSON");
  try {
    return jsonStringify(snapshot.value);
  } catch {
    requestInvalid("Local integration request body must be serializable JSON");
  }
}

function buildRequest(
  endpoint: IntegrationEndpoint,
  args: Record<string, unknown>,
  authHeaders: Readonly<Record<string, string>>,
  allowedOrigin: string,
  signal: AbortSignal,
): LocalIntegrationEndpointTransportRequest {
  assertKnownArguments(args, endpoint);
  let endpointUrl = endpoint.url;
  const headers = new HeadersConstructor();

  const parameterNames = objectKeys(endpoint.params ?? {});
  for (let index = 0; index < parameterNames.length; index++) {
    const name = parameterNames[index]!;
    const field = endpoint.params?.[name];
    if (!field) continue;
    const resolved = fieldValue(args, name, field);
    if (!resolved.present) continue;
    if (field.in === "path") {
      endpointUrl = replaceAll(
        endpointUrl,
        `{${name}}`,
        encodeUriComponent(scalarString(resolved.value)),
      );
    } else if (field.in === "header") {
      setHeader(headers, field.headerName ?? name, scalarString(resolved.value));
    }
  }

  if (callStringBoolean(stringIncludes, endpointUrl, "{")) {
    requestInvalid("Local integration endpoint contains an unresolved path parameter");
  }

  let url: URL;
  try {
    url = new URLConstructor(endpointUrl);
  } catch {
    requestInvalid("Local integration endpoint URL is invalid");
  }
  if (urlValue(urlOrigin, url) !== allowedOrigin) {
    requestInvalid("Local integration endpoint origin does not match its admitted origin");
  }

  if (!urlSearchParams) requestFailed();
  const searchParams = apply(urlSearchParams, url, []) as URLSearchParams;
  for (let index = 0; index < parameterNames.length; index++) {
    const name = parameterNames[index]!;
    const field = endpoint.params?.[name];
    if (!field || field.in !== "query") continue;
    const resolved = fieldValue(args, name, field);
    if (resolved.present) appendQueryValue(searchParams, name, resolved.value, field);
  }

  const authHeaderNames = objectKeys(authHeaders);
  for (let index = 0; index < authHeaderNames.length; index++) {
    const name = authHeaderNames[index]!;
    const value = ownValue(authHeaders, name);
    if (!value.present || typeof value.value !== "string") {
      requestInvalid("Local integration authorization headers are invalid");
    }
    setHeader(headers, name, value.value);
  }

  let body: string | undefined;
  const bodyFields = objectKeys(endpoint.body ?? {});
  if (endpoint.bodyMode === "passthrough") {
    if (bodyFields.length !== 1) {
      requestInvalid("Local integration passthrough bodies require exactly one field");
    }
    const name = bodyFields[0]!;
    const field = endpoint.body?.[name]!;
    const resolved = fieldValue(args, name, field);
    if (resolved.present) body = serializeJson(resolved.value);
  } else if (bodyFields.length > 0) {
    const record = objectCreate(null) as Record<string, unknown>;
    for (let index = 0; index < bodyFields.length; index++) {
      const name = bodyFields[index]!;
      const field = endpoint.body?.[name]!;
      const resolved = fieldValue(args, name, field);
      if (resolved.present) {
        objectDefineProperty(record, name, {
          configurable: true,
          enumerable: true,
          value: resolved.value,
          writable: true,
        });
      }
    }
    body = serializeJson(record);
  }

  if (body !== undefined) {
    setHeader(headers, "Content-Type", endpoint.contentType ?? "application/json");
  }

  return freeze({
    url,
    allowedOrigin,
    init: freeze({
      method: endpoint.method,
      headers,
      body,
      redirect: "error" as const,
      signal,
    }),
  });
}

function createRequestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): RequestSignalLease {
  if (!numberIsSafeInteger(timeoutMs) || timeoutMs <= 0) {
    requestInvalid("Local integration timeout must be a positive safe integer");
  }
  const controller = new AbortControllerConstructor();
  const abort = (): void => {
    const reason = signal ? signalValue(abortSignalReason, signal) : undefined;
    apply(abortControllerAbort, controller, [reason]);
  };
  if (signal && signalValue(abortSignalAborted, signal)) abort();
  else if (signal) apply(addEventListener, signal, ["abort", abort, { once: true }]);

  const timeoutId = setTimeoutIntrinsic(() => {
    apply(abortControllerAbort, controller, [
      new DOMExceptionConstructor("Request timed out", "TimeoutError"),
    ]);
  }, timeoutMs);

  return freeze({
    signal: controllerSignalValue(controller),
    release(): void {
      clearTimeoutIntrinsic(timeoutId);
      if (signal) apply(removeEventListener, signal, ["abort", abort]);
    },
  });
}

const guardedTransport: LocalIntegrationEndpointTransport = async (request) => {
  return await guardedEgressFetch(request.url, request.init, {
    authorizeUrl(url): void {
      if (urlValue(urlOrigin, url) !== request.allowedOrigin) {
        throw LOCAL_INTEGRATION_REQUEST_FAILED.create();
      }
    },
  });
};

function contentLengthWithinLimit(response: Response): boolean {
  const raw = apply(headersGet, responseHeadersValue(response), [
    "content-length",
  ]) as string | null;
  if (raw === null) return true;
  if (raw.length === 0) return false;
  let value = 0;
  for (let index = 0; index < raw.length; index++) {
    const code = charCodeAt(raw, index);
    if (code < 48 || code > 57) return false;
    value = value * 10 + code - 48;
    if (!numberIsSafeInteger(value) || value > MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES) {
      return false;
    }
  }
  return true;
}

function decodedByteLength(value: string): number {
  const encoded = apply(textEncoderEncode, textEncoder, [value]) as Uint8Array;
  if (!typedArrayByteLength) responseInvalid();
  return apply(typedArrayByteLength, encoded, []) as number;
}

async function readResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!contentLengthWithinLimit(response)) responseInvalid();
  let text: string;
  let truncated: boolean;
  try {
    ({ text, truncated } = await readResponseTextPrefix(
      response,
      MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES + 1,
      signal,
      { fatalUtf8: true },
    ));
  } catch {
    responseInvalid();
  }
  if (
    truncated ||
    decodedByteLength(text) > MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES
  ) {
    responseInvalid();
  }
  let parsed: unknown;
  try {
    parsed = jsonParse(text);
  } catch {
    responseInvalid();
  }
  const snapshot = snapshotBoundedJsonValue(parsed);
  if (!snapshot.success) responseInvalid();
  return snapshot.value;
}

async function executeTransportRequest(
  request: LocalIntegrationEndpointTransportRequest,
  transport: LocalIntegrationEndpointTransport,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await transport(request);
  } catch {
    requestFailed();
  }
  const status = responseStatusValue(response);
  if (status < 200 || status >= 300) {
    try {
      const body = responseBodyValue(response);
      if (body) {
        const cancellation = apply(readableStreamCancel, body, []) as Promise<void>;
        void apply(promiseCatch, cancellation, [() => undefined]);
      }
    } catch {
      // Response cleanup is best effort and must not expose provider errors.
    }
    requestFailed();
  }
  return await readResponseJson(response, signal);
}

function transformResponse(value: unknown, transform: string | undefined): unknown {
  if (transform === undefined || transform === "") return value;
  let current = value;
  let start = 0;
  for (let index = 0; index <= transform.length; index++) {
    if (index < transform.length && charCodeAt(transform, index) !== 46) continue;
    const segment = slice(transform, start, index);
    if (segment === "" || !isRecord(current)) responseInvalid();
    const next = ownValue(current, segment);
    if (!next.present) responseInvalid();
    current = next.value;
    start = index + 1;
  }
  return current;
}

/** Execute one admitted catalog REST endpoint through a bounded guarded transport. */
export async function executeLocalIntegrationEndpoint(
  options: ExecuteLocalIntegrationEndpointOptions,
): Promise<unknown> {
  const args = snapshotArguments(options.args);
  const signalLease = createRequestSignal(
    options.signal,
    options.timeoutMs ?? INTEGRATION_REQUEST_TIMEOUT_MS,
  );
  try {
    const request = buildRequest(
      options.endpoint,
      args,
      options.authHeaders,
      options.allowedOrigin,
      signalLease.signal,
    );
    const value = await executeTransportRequest(
      request,
      options.transport ?? guardedTransport,
      signalLease.signal,
    );
    return transformResponse(value, options.endpoint.response?.transform);
  } finally {
    signalLease.release();
  }
}

/** Execute one fixed-origin JSON request, including OAuth token requests. */
export async function executeLocalIntegrationJsonRequest(
  options: ExecuteLocalIntegrationJsonRequestOptions,
): Promise<unknown> {
  const signalLease = createRequestSignal(
    options.signal,
    options.timeoutMs ?? INTEGRATION_REQUEST_TIMEOUT_MS,
  );
  try {
    let url: URL;
    try {
      url = new URLConstructor(options.url);
    } catch {
      requestInvalid("Local integration request URL is invalid");
    }
    if (urlValue(urlOrigin, url) !== options.allowedOrigin) {
      requestInvalid("Local integration request origin does not match its admitted origin");
    }
    const headers = new HeadersConstructor();
    const headerNames = objectKeys(options.headers);
    for (let index = 0; index < headerNames.length; index++) {
      const name = headerNames[index]!;
      const value = ownValue(options.headers, name);
      if (!value.present || typeof value.value !== "string") {
        requestInvalid("Local integration authorization headers are invalid");
      }
      setHeader(headers, name, value.value);
    }
    const request = freeze({
      url,
      allowedOrigin: options.allowedOrigin,
      init: freeze({
        method: options.method,
        headers,
        body: options.body,
        redirect: "error" as const,
        signal: signalLease.signal,
      }),
    });
    return await executeTransportRequest(
      request,
      options.transport ?? guardedTransport,
      signalLease.signal,
    );
  } finally {
    signalLease.release();
  }
}
