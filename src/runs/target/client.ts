/**
 * Typed SDK for the Runs target contract (veryfront-issue-inbox#2522). One method per
 * contract operation; request and response types come from the pinned contract.
 *
 * The caller supplies the HTTP transport. Nothing in the framework wires this SDK to a
 * live endpoint yet: the deployed API still serves the legacy routes that
 * `../runs-client.ts` calls, and the integration lane (#2239) switches consumers over.
 */
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { components, operations } from "../contract/runs-api.generated.ts";
import { RUNS_OPERATIONS } from "./operations.ts";

/** Contract operation ID. */
export type RunsOperationId = keyof operations;

/** RFC 9457 problem body that every Runs error response carries. */
export type RunsProblem = components["schemas"]["Problem"];

/** One server-sent frame of `streamRunEvents`. */
export interface RunStreamFrame {
  /** Durable event ID; pass it as `Last-Event-ID` to resume after this frame. */
  id: string | null;
  event: components["schemas"]["RunStreamEvent"];
}

/** Sends one request and returns the response, for example `fetch`. */
export type RunsTransport = (request: Request) => Promise<Response>;

/** Credential sent as `Authorization: Bearer` or as the `X-API-Key` header. */
export type RunsCredential = { bearer: string } | { apiKey: string };

/** Configuration for {@link createRunsSdk}. */
export interface RunsSdkConfig {
  /** API origin, for example `https://api.veryfront.com`. */
  baseUrl: string;
  transport: RunsTransport;
  credential?: RunsCredential;
}

/** Per-call options. */
export interface RunsCallOptions {
  /** Overrides the configured credential, for example with a run execution token. */
  credential?: RunsCredential;
  signal?: AbortSignal;
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

/** Success body of one operation; `undefined` for 204 responses. */
export type RunsOutput<K extends RunsOperationId> = SuccessResponse<K> extends
  { content: { "application/json": infer B } } ? B : undefined;

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

/** Typed client for every Runs target operation. */
export type RunsSdk =
  & { readonly [K in RunsOperationId]: (...args: RunsArgs<K>) => RunsResult<K> }
  & {
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
const FALLBACK_PROBLEM_CODE = "UNEXPECTED_RESPONSE";

/** Create a typed Runs SDK over the given transport. */
export function createRunsSdk(config: RunsSdkConfig): RunsSdk {
  const send = async (operationId: RunsOperationId, input: WireInput, options: RunsCallOptions) => {
    const response = await config.transport(buildRequest(config, operationId, input, options));
    if (!response.ok) throw await problemError(operationId, response);
    options.onHeaders?.(response.headers);
    return response;
  };

  const call = async (
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): Promise<unknown> => readJson(operationId, await send(operationId, input, options));

  async function* stream(
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): AsyncGenerator<RunStreamFrame> {
    yield* readFrames(operationId, await send(operationId, input, options));
  }

  async function* paginate(
    operationId: RunsOperationId,
    input: WireInput = {},
    options: RunsCallOptions = {},
  ): AsyncGenerator<unknown> {
    let cursor = input.query?.cursor;
    const seen = new Set([cursor]);
    while (true) {
      const page = await call(
        operationId,
        { ...input, query: { ...input.query, cursor } },
        options,
      ) as Page;
      yield* page.data;
      const next = page.page_info?.next ?? null;
      if (next === null) return;
      if (seen.has(next)) {
        throw API_CLIENT_ERROR.create({
          detail: `${operationId} returned an already used cursor as page_info.next`,
          status: 502,
        });
      }
      seen.add(next);
      cursor = next;
    }
  }

  const methods: Record<string, unknown> = { paginate };
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
  config: RunsSdkConfig,
  operationId: RunsOperationId,
  input: WireInput,
  options: RunsCallOptions,
): Request {
  const route = RUNS_OPERATIONS[operationId];
  const path = route.path.replace(PATH_PARAMETER, (_match, name: string) => {
    const value = input.path?.[name];
    if (value === undefined) {
      throw new TypeError(`${operationId} requires the path parameter ${name}`);
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(`${config.baseUrl.replace(/\/+$/, "")}${path}`);
  for (const [name, value] of Object.entries(input.query ?? {})) {
    for (const item of [value].flat()) {
      if (item != null) url.searchParams.append(name, String(item));
    }
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  const credential = options.credential ?? config.credential;
  if (credential && "bearer" in credential) {
    headers.set("Authorization", `Bearer ${credential.bearer}`);
  } else if (credential) {
    headers.set("X-API-Key", credential.apiKey);
  }
  headers.set("Accept", "stream" in route ? "text/event-stream" : "application/json");
  if (input.body !== undefined) headers.set("Content-Type", "application/json");

  return new Request(url, {
    method: route.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: options.signal,
    // Fetch strips only `Authorization` on a cross-origin redirect, so following one
    // could hand `X-API-Key` to another origin.
    redirect: credential ? "error" : "follow",
  });
}

async function readJson(operationId: RunsOperationId, response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  return parseJson(operationId, await response.text());
}

async function* readFrames(
  operationId: RunsOperationId,
  response: Response,
): AsyncGenerator<RunStreamFrame> {
  if (!response.body) return;
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    // A trailing CR may be the first half of a CRLF split across chunks.
    buffer = `${buffer}${chunk}`.replace(/\r\n|\r(?!$)/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = parseFrame(operationId, buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (frame) yield frame;
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/** Parse one SSE frame; comment-only frames such as keep-alives yield nothing. */
function parseFrame(operationId: RunsOperationId, raw: string): RunStreamFrame | null {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event: parseJson(operationId, data.join("\n")) as RunStreamFrame["event"] };
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

async function problemError(operationId: RunsOperationId, response: Response) {
  const problem = await readProblem(response);
  return API_CLIENT_ERROR.create({
    detail: problem.detail ?? problem.title,
    status: response.status,
    instance: problem.instance,
    context: { operationId, problem },
  });
}

async function readProblem(response: Response): Promise<RunsProblem> {
  const text = await response.text();
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
