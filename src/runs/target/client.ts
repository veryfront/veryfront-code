/**
 * Typed SDK for the Runs target contract (veryfront-issue-inbox#2522). One method per
 * contract operation; request and response types come from the pinned contract.
 *
 * The caller supplies the canonical Veryfront API transport. Nothing in the framework wires this SDK to a
 * live endpoint yet: the deployed API still serves the legacy routes that
 * `../runs-client.ts` calls, and the integration lane (#2239) switches consumers over.
 */
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  readVeryfrontApiResponse,
  requireSuccessResponseByteLimit,
  successfulResponseProtocolError,
  type TransportRequestInit,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import type { components, operations } from "../contract/runs-api.generated.ts";
import {
  isCommentOnlySseFrame,
  MAX_SSE_FRAME_CHARS,
  normalizeNewlines,
  splitSseFrames,
} from "#veryfront/utils/sse-frames.ts";
import { RUNS_OPERATIONS } from "./operations.ts";

/** Contract operation ID. */
export type RunsOperationId = keyof operations;

/**
 * RFC 9457 Runs error body. Optional `cause` identifies
 * `schedule_concurrency_forbidden` (overlapping fires forbidden) or
 * `schedule_fire_in_progress` (the same fire is being processed).
 */
// Public causes postdate the immutable pin; remove the extension when the pin includes them.
export type RunsProblem = components["schemas"]["Problem"] & {
  /** Schedule admission refusal. */
  cause?: "schedule_concurrency_forbidden" | "schedule_fire_in_progress";
};

/** Canonical JSON carried by the data field of the Runs event stream. */
export interface CanonicalRunStreamFrame {
  /** Durable reconnect cursor; null for transient frames. */
  event_id: number | null;
  /** Stored event type used as the SSE event name. */
  event_type: string;
  /** Authorized AG-UI event, including fields of future event types. */
  payload: { type: string; [key: string]: unknown };
  /** Error classification from the stored event. */
  is_error: boolean;
  /** Stored timestamp; null when the frame has no stored timestamp. */
  created_at: string | null;
}

/** One server-sent frame of `streamRunEvents`. */
export interface RunStreamFrame {
  /** Durable event ID; pass it as `Last-Event-ID` to resume after this frame. */
  id: string | null;
  /** Canonical metadata envelope and its authorized event payload. */
  event: CanonicalRunStreamFrame;
}

/** Configuration for {@link createRunsSdk}. */
export interface RunsSdkConfig {
  /**
   * Host-owned canonical transport, including origin, credentials and telemetry, for example
   * from `createRunsApiTransport`. A test double must pass each response to `init.onResponse`
   * and resolve with its result.
   */
  transport: VeryfrontApiTransport<unknown>;
}

/** Per-call options. */
export interface RunsCallOptions {
  signal?: AbortSignal;
  /** Uses the canonical transport's bounded success-body decoder. */
  maxResponseBytes?: number;
  /**
   * Receives the success response headers, for example the `ETag` of `getRun` that
   * `updateRun` needs as `If-Match`, or the `Location` of `createRun`.
   */
  onHeaders?: (headers: Headers) => void;
}

type Operation<K extends RunsOperationId> = operations[K];
type Section<T, S extends PropertyKey> = S extends keyof T ? Exclude<T[S], undefined> : never;
type Parameters<K extends RunsOperationId> = Operation<K>["parameters"];
type Slot<Name extends string, T> = [T] extends [never] ? unknown
  : Partial<T> extends T ? { [P in Name]?: T }
  : { [P in Name]: T };
type JsonContent<T> = T extends { content: { "application/json": infer B } } ? B : never;
type RequestBody<K extends RunsOperationId> = Section<Operation<K>, "requestBody">;
type BodySlot<K extends RunsOperationId> = [RequestBody<K>] extends [never] ? unknown
  : undefined extends Operation<K>["requestBody"] ? { body?: JsonContent<RequestBody<K>> }
  : { body: JsonContent<RequestBody<K>> };

/** Request of one operation: path, query and header parameters plus the JSON body. */
export type RunsInput<K extends RunsOperationId> =
  & Slot<"path", Section<Parameters<K>, "path">>
  & Slot<"query", Section<Parameters<K>, "query">>
  & Slot<"headers", Section<Parameters<K>, "header">>
  & BodySlot<K>;

type SuccessResponse<K extends RunsOperationId> = Operation<K>["responses"][
  Extract<
    keyof Operation<K>["responses"],
    200 | 201 | 202 | 204
  >
];

type SuccessBody<R> = R extends { content: { "application/json": infer B } } ? B : undefined;

/** Acknowledgement body of a DELETE answered with 200 instead of an empty 204. */
export interface RunsDeleteAcknowledgement {
  ok: true;
}

// Older API versions answer DELETE with an empty 204 instead of the pinned 200 body.
type LegacyDeleteResponse<K extends RunsOperationId> = (typeof RUNS_OPERATIONS)[K]["method"] extends
  "DELETE" ? undefined : never;

/**
 * Success body of one operation: the JSON body of each success response, `undefined` for a
 * 204 response. A DELETE may answer 200 with {@link RunsDeleteAcknowledgement} or an empty 204.
 * Distributes over a union of operations, so each member keeps its own success body.
 */
export type RunsOutput<K extends RunsOperationId> = K extends RunsOperationId
  ? SuccessBody<SuccessResponse<K>> | LegacyDeleteResponse<K>
  : never;

/** What an SDK method returns: the parsed body, or the frames of an event stream. */
export type RunsResult<K extends RunsOperationId> = SuccessResponse<K> extends
  { content: { "text/event-stream": unknown } } ? AsyncIterable<RunStreamFrame>
  : Promise<RunsOutput<K>>;

/** Method arguments; the input is optional when it has no required field. */
export type RunsArgs<K extends RunsOperationId> = Partial<RunsInput<K>> extends RunsInput<K>
  ? [input?: RunsInput<K>, options?: RunsCallOptions]
  : [input: RunsInput<K>, options?: RunsCallOptions];

type PageItem<K extends RunsOperationId> = RunsOutput<K> extends
  { data: Array<infer I>; page_info: unknown } ? I : never;

/** Operations whose responses page with `page_info.next` and a `cursor` query parameter. */
export type RunsPaginatedOperationId = {
  [K in RunsOperationId]: [PageItem<K>] extends [never] ? never
    : "cursor" extends keyof Section<Parameters<K>, "query"> ? K
    : never;
}[RunsOperationId];

/** Input of `readRunArtifact`: the canonical run UUID and an `artifact_id` from `run.artifacts`. */
export interface RunsArtifactInput {
  path: { run_id: string; artifact_id: string };
}

/** Typed client for every Runs target operation. */
export type RunsSdk =
  & { readonly [K in RunsOperationId]: (...args: RunsArgs<K>) => RunsResult<K> }
  & {
    /**
     * Downloads a file a run produced (`GET /runs/{run_id}/artifacts/{artifact_id}`) as a
     * `Blob`, bounded by `maxResponseBytes`. An error response rejects like every other method.
     */
    readRunArtifact(input: RunsArtifactInput, options?: RunsCallOptions): Promise<Blob>;
    /** Yields every item of a paginated list, following `page_info.next`. */
    paginate<K extends RunsPaginatedOperationId>(
      operationId: K,
      ...args: RunsArgs<K>
    ): AsyncIterable<PageItem<K>>;
  };

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

interface WireInput {
  path?: Record<string, string | number>;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

interface Page {
  data: unknown[];
  page_info?: { next: string | null };
}

const PATH_PARAMETER = /\{(\w+)\}/g;
const replacePath = String.prototype.replace;
const applyPath = Reflect.apply;
const FALLBACK_PROBLEM_CODE = "UNEXPECTED_RESPONSE";

/** Operation IDs the SDK serves, including binary operations outside the pinned contract. */
type SdkOperationId = RunsOperationId | "readRunArtifact";

interface SdkRoute {
  method: string;
  path: string;
  stream?: true;
  binary?: true;
}

// The artifact download postdates the immutable 0.8.9 pin; move it into RUNS_OPERATIONS when
// the pin includes it.
const READ_RUN_ARTIFACT_ROUTE: SdkRoute = Object.freeze({
  method: "GET",
  path: "/runs/{run_id}/artifacts/{artifact_id}",
  binary: true,
});

function routeOf(operationId: SdkOperationId): SdkRoute {
  return operationId === "readRunArtifact" ? READ_RUN_ARTIFACT_ROUTE : RUNS_OPERATIONS[operationId];
}

/** Create a typed Runs SDK over the given transport. */
export function createRunsSdk(config: RunsSdkConfig): RunsSdk {
  const send = async (operationId: SdkOperationId, input: WireInput, options: RunsCallOptions) => {
    const { path, init } = buildRequest(operationId, input, options);
    let headers: Headers | undefined;
    const result = await config.transport.request(path, {
      ...init,
      onResponse: async (response, responseInit, url, signal) => {
        if (response.ok) headers = response.headers;
        const route = routeOf(operationId);
        if (response.ok && route.stream) return response;
        // Read the artifact here, under the attempt's timeout, abort signal and retry policy.
        if (response.ok && route.binary) {
          // Validate the limit here too: a custom transport may pass it through unnormalized.
          return await readBlob(
            response,
            requireSuccessResponseByteLimit(
              responseInit.maxResponseBytes ?? options.maxResponseBytes,
            ),
            url,
            signal,
          );
        }
        try {
          return await readVeryfrontApiResponse(response, responseInit, url, signal);
        } catch (error) {
          if (!response.ok && error instanceof VeryfrontError) {
            const context = error.context as { details?: { responseText?: string } } | undefined;
            throw problemError(operationId, response, context?.details?.responseText ?? "");
          }
          throw error;
        }
      },
    });
    if (headers) options.onHeaders?.(headers);
    return result;
  };

  const call = async (
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): Promise<unknown> => send(operationId, input, options);

  async function* stream(
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): AsyncGenerator<RunStreamFrame> {
    yield* readFrames(
      operationId,
      await send(operationId, input, options) as Response,
      options.signal,
    );
  }

  async function* paginate(
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): AsyncGenerator<unknown> {
    let cursor = input.query?.cursor;
    const initialCursor = cursor;
    // Brent cycle detection retains a fixed number of cursors across any number of pages.
    let anchor = cursor;
    let power = 1;
    let distance = 0;
    while (true) {
      const page = await call(
        operationId,
        { ...input, query: { ...input.query, cursor } },
        options,
      ) as Page;
      options.signal?.throwIfAborted();
      const next = page.page_info?.next ?? null;
      if (next !== null && (next === cursor || next === initialCursor || next === anchor)) {
        throw API_CLIENT_ERROR.create({
          detail: `${operationId} returned an already used cursor as page_info.next`,
          status: 502,
        });
      }
      for (const item of page.data) {
        options.signal?.throwIfAborted();
        yield item;
      }
      options.signal?.throwIfAborted();
      if (next === null) return;
      distance++;
      if (distance === power) {
        anchor = next;
        power *= 2;
        distance = 0;
      }
      cursor = next;
    }
  }

  const readRunArtifact = async (input: RunsArtifactInput, options: RunsCallOptions = {}) =>
    await send("readRunArtifact", input, options) as Blob;

  const methods: Record<string, unknown> = { paginate, readRunArtifact };
  for (const [operationId, route] of Object.entries(RUNS_OPERATIONS)) {
    methods[operationId] = "stream" in route
      ? (input?: WireInput, options?: RunsCallOptions) =>
        stream(operationId as RunsOperationId, input, options)
      : (input?: WireInput, options?: RunsCallOptions) =>
        call(operationId as RunsOperationId, input, options);
  }
  return Object.freeze(methods) as RunsSdk;
}

/** The problem body of an error thrown by the SDK, or `undefined` for any other error. */
export function runsProblemOf(error: unknown): RunsProblem | undefined {
  if (!(error instanceof VeryfrontError)) return undefined;
  const context = error.context as { problem?: RunsProblem } | undefined;
  return context?.problem;
}

function buildRequest(
  operationId: SdkOperationId,
  input: WireInput,
  options: RunsCallOptions,
): { path: string; init: TransportRequestInit } {
  const route = routeOf(operationId);
  const path = applyPath(replacePath, route.path, [
    PATH_PARAMETER,
    (_match: string, name: string) => {
      const value = input.path?.[name];
      if (value === undefined) {
        throw new TypeError(`${operationId} requires the path parameter ${name}`);
      }
      return encodeURIComponent(String(value));
    },
  ]) as string;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input.query ?? {})) {
    for (const item of [value].flat()) {
      if (item != null) query.append(name, String(item));
    }
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  headers.set(
    "Accept",
    route.stream ? "text/event-stream" : route.binary ? "*/*" : "application/json",
  );
  if (input.body !== undefined) headers.set("Content-Type", "application/json");

  return {
    path: query.size ? `${path}?${query}` : path,
    init: {
      method: route.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: options.signal,
      maxResponseBytes: options.maxResponseBytes,
    },
  };
}

/**
 * Read a binary success body into a `Blob`, failing closed once it exceeds `limit` bytes.
 * An abort of `signal` (attempt timeout or caller) cancels a pending read and rejects.
 */
async function readBlob(
  response: Response,
  limit: number,
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const tooLarge = () =>
    successfulResponseProtocolError(
      `readRunArtifact returned an artifact over ${limit} bytes`,
      url,
    );
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.body) return new Blob([], { type });
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  // Cancelling the reader settles a pending read, which then rethrows the abort reason.
  const cancelOnAbort = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
  }
  return new Blob(chunks as BlobPart[], { type });
}

async function* readFrames(
  operationId: RunsOperationId,
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<RunStreamFrame> {
  if (!response.body) return;
  let remainder = "";
  function* complete(input: string): Generator<RunStreamFrame> {
    const split = splitSseFrames(normalizeNewlines(input));
    remainder = split.remainder;
    if ([remainder, ...split.frames].some((raw) => raw.length > MAX_SSE_FRAME_CHARS)) {
      throw API_CLIENT_ERROR.create({
        detail: `${operationId} sent an event-stream frame over ${MAX_SSE_FRAME_CHARS} characters`,
        status: 502,
        context: { operationId },
      });
    }
    for (const raw of split.frames) {
      const frame = isCommentOnlySseFrame(raw) ? null : parseFrame(operationId, raw);
      if (frame) yield frame;
    }
  }
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream(), { signal })) {
    // A trailing CR may be the first half of a CRLF split across chunks; hold it back.
    const combined = `${remainder}${chunk}`;
    const held = combined.endsWith("\r");
    yield* complete(held ? combined.slice(0, -1) : combined);
    if (held) remainder += "\r";
  }
  // At the end of the body a trailing CR is a line end in its own right.
  yield* complete(remainder);
}

/** Parse one SSE frame; a frame without data yields nothing. */
function parseFrame(operationId: RunsOperationId, raw: string): RunStreamFrame | null {
  let id: string | null = null;
  let eventType: string | undefined;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") eventType = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  const event = parseJson(operationId, data.join("\n"));
  if (
    !isCanonicalFrame(event) || event.payload.type !== event.event_type ||
    (eventType !== undefined && eventType !== event.event_type) ||
    (id !== null && (event.event_id === null || id !== String(event.event_id)))
  ) {
    throw API_CLIENT_ERROR.create({
      detail: `${operationId} returned an invalid canonical event-stream frame`,
      status: 502,
      context: { operationId },
    });
  }
  return { id, event };
}

function isCanonicalFrame(value: unknown): value is CanonicalRunStreamFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  const payload = frame.payload;
  return (frame.event_id === null ||
    (typeof frame.event_id === "number" && Number.isInteger(frame.event_id) &&
      frame.event_id >= 0)) &&
    typeof frame.event_type === "string" && frame.event_type.length > 0 &&
    typeof payload === "object" && payload !== null && !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).type === "string" &&
    (payload as Record<string, unknown>).type !== "" &&
    typeof frame.is_error === "boolean" &&
    (frame.created_at === null || typeof frame.created_at === "string");
}

/** Parse a success body; malformed JSON becomes an API client error, not a `SyntaxError`. */
function parseJson(operationId: RunsOperationId, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw API_CLIENT_ERROR.create({
      detail: `${operationId} returned a body that is not valid JSON`,
      status: 502,
      cause,
      context: { operationId },
    });
  }
}

function problemError(operationId: SdkOperationId, response: Response, text: string) {
  const problem = readProblem(response, text);
  return API_CLIENT_ERROR.create({
    detail: problem.detail ?? problem.title,
    status: response.status,
    instance: problem.instance,
    context: { operationId, problem },
  });
}

function readProblem(response: Response, text: string): RunsProblem {
  try {
    const parsed = JSON.parse(text);
    if (isProblem(parsed)) return parsed;
  } catch {
    // Not JSON: fall through to a problem built from the status line.
  }
  return {
    type: "about:blank",
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
    code: FALLBACK_PROBLEM_CODE,
  };
}

function isProblem(value: unknown): value is RunsProblem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string" && typeof candidate.title === "string" &&
    typeof candidate.status === "number" && typeof candidate.code === "string";
}
