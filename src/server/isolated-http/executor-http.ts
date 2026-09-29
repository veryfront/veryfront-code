import type {
  ExecutorChannel,
  ExecutorOperation,
  ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { createWorkerTraceRecorder } from "#veryfront/observability/tracing/worker-trace-recorder.ts";
import { parseTraceparent } from "#veryfront/observability/tracing/traceparent.ts";
import { runWithExecutorHttpTraceScope } from "#veryfront/observability/tracing/executor-http-trace-scope.ts";
import { runWithProjectTraceProvider } from "#veryfront/observability/tracing/project-trace-scope.ts";
import {
  type ApplicationRequestHeaderOptions,
  createApplicationRequestHeaders,
} from "#veryfront/security/http/application-request.ts";

const CHUNK_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;
const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const encode = globalThis.btoa.bind(globalThis);
const decode = globalThis.atob.bind(globalThis);
const randomId = crypto.randomUUID.bind(crypto);
const getHeadersSchema = defineSchema((v) =>
  v.array(v.tuple([
    v.string().min(1).max(256),
    v.string().max(MAX_HEADER_BYTES),
  ])).max(128)
);
const getRequestSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    url: v.string().min(1).max(8192),
    method: v.string().min(1).max(32),
    headers: getHeadersSchema(),
    body: v.boolean(),
    traceparent: v.string().max(128).optional(),
  }).strict()
);
const getBodyRequestSchema = defineSchema((v) => v.object({ id: v.string().uuid() }).strict());
const getHeadSchema = defineSchema((v) =>
  v.object({
    type: v.literal("head"),
    status: v.number().int().min(200).max(599),
    statusText: v.string().max(256),
    headers: getHeadersSchema(),
    body: v.boolean(),
  }).strict()
);
const getChunkSchema = defineSchema((v) =>
  v.object({
    type: v.literal("chunk"),
    data: v.string().min(4).max(4 * Math.ceil(CHUNK_BYTES / 3)),
  }).strict()
);
const getTraceSchema = defineSchema((v) =>
  v.object({
    type: v.literal("traces"),
    records: v.string().max(256 * 1024),
  }).strict()
);

export interface ExecutorHttpTracing {
  /** Host-owned application parent; no collector endpoint or credentials cross the channel. */
  traceparent: string;
  /** Import through the original request's project provider, which validates and fixes ownership. */
  onRecords(records: string): void;
}

function invalid(): Error {
  return new Error("Invalid executor HTTP message");
}

function parse<T>(schema: Schema<T>, input: unknown): T {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) throw invalid();
  const result = schema.safeParse(snapshot.value);
  if (!result.success) throw invalid();
  return result.data;
}

function assertBinding(expected: ExecutorBinding, context: ExecutorOperationContext): void {
  if (
    expected.allocationId !== context.binding.allocationId ||
    expected.generation !== context.binding.generation ||
    expected.invocationId !== context.binding.invocationId
  ) throw invalid();
  context.signal.throwIfAborted();
}

function copyHeaders(input: Headers | string[][]): Headers {
  const headers = input instanceof Headers ? new Headers(input) : new Headers();
  if (!(input instanceof Headers)) {
    for (const pair of input) {
      if (pair.length !== 2) throw invalid();
      headers.append(pair[0]!, pair[1]!);
    }
  }
  const connectionNames = (headers.get("connection") ?? "").split(",").map((name) => name.trim());
  for (const name of [...HOP_HEADERS, ...connectionNames]) if (name) headers.delete(name);
  let bytes = 0;
  for (const [key, value] of headers) bytes += new TextEncoder().encode(key + value).byteLength;
  if (bytes > MAX_HEADER_BYTES) throw invalid();
  return headers;
}

function headerPairs(headers: Headers): string[][] {
  const filtered = copyHeaders(headers);
  const pairs: [string, string][] = [];
  for (const [name, value] of filtered) {
    if (name !== "set-cookie") pairs.push([name, value]);
  }
  for (const value of filtered.getSetCookie()) pairs.push(["set-cookie", value]);
  return parse(getHeadersSchema(), pairs);
}

function decodeChunk(input: JsonValue): Uint8Array {
  const { data } = parse(getChunkSchema(), input);
  let binary: string;
  try {
    binary = decode(data);
  } catch {
    throw invalid();
  }
  if (!binary.length || binary.length > CHUNK_BYTES || encode(binary) !== data) throw invalid();
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function* bodyChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  run: <T>(operation: () => T) => T = (operation) => operation(),
): AsyncGenerator<JsonValue> {
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await run(() => reader.read());
      signal.throwIfAborted();
      if (done) return;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw invalid();
      for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
        const chunk = value.subarray(offset, offset + CHUNK_BYTES);
        let binary = "";
        for (const byte of chunk) binary += String.fromCharCode(byte);
        yield { type: "chunk", data: encode(binary) };
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    // A teed stream waits for its other branch's cancellation. That branch is
    // not owned by this operation and must not delay response/channel completion.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* responseBodyFrames(
  iterator: AsyncIterableIterator<JsonValue>,
  onRecords?: (records: string) => void,
): AsyncGenerator<JsonValue> {
  let tracesReceived = false;
  try {
    for await (const value of iterator) {
      if (tracesReceived) throw invalid();
      if (value && typeof value === "object" && !Array.isArray(value) && value.type === "traces") {
        const { records } = parse(getTraceSchema(), value);
        tracesReceived = true;
        try {
          // A telemetry callback must not turn a successful HTTP body into an error.
          void Promise.resolve(onRecords?.(records)).catch(() => {});
        } catch { /* Project trace export is best effort. */ }
      } else yield value;
    }
  } finally {
    await iterator.return?.();
  }
}

function decodedBody(
  iterator: AsyncIterableIterator<JsonValue>,
  finish: () => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          finish();
          controller.close();
          return;
        }
        const chunk = decodeChunk(next.value);
        total += chunk.byteLength;
        if (total > MAX_BODY_BYTES) throw invalid();
        controller.enqueue(chunk);
      } catch (error) {
        finish();
        void iterator.return?.().catch(() => {});
        controller.error(error);
      }
    },
    async cancel() {
      finish();
      await iterator.return?.();
    },
  }, { highWaterMark: 0 });
}

interface BoundChannel {
  /** Already authenticated and bound by the existing executor installation. */
  channel(): ExecutorChannel;
  binding: ExecutorBinding;
}

/**
 * HTTP transport for one authenticated executor generation. This does not allocate
 * a sandbox, authorize source, or enable host execution. Install the returned body
 * operation on the broker channel before its handshake; keep this client owned by
 * the existing generation lifetime until response consumption and shutdown settle.
 */
export function createExecutorHttpClient(options: BoundChannel & ApplicationRequestHeaderOptions) {
  const binding = parse(getExecutorBindingSchema(), options.binding);
  const channelForGeneration = options.channel;
  const headerOptions = { denyHeaders: options.denyHeaders?.slice() };
  const pending = new Map<string, {
    body: ReadableStream<Uint8Array>;
    claimed: boolean;
    signal: AbortSignal;
  }>();
  const lifetime = new AbortController();
  const bodyOperation: ExecutorOperation = {
    mode: "stream",
    async *handle(input, context) {
      assertBinding(binding, context);
      const { id } = parse(getBodyRequestSchema(), input);
      const entry = pending.get(id);
      if (!entry || entry.claimed) throw invalid();
      entry.claimed = true;
      yield* bodyChunks(entry.body, AbortSignal.any([entry.signal, context.signal]));
    },
  };

  return {
    operations: new Map<string, ExecutorOperation>([["http.request-body", bodyOperation]]),
    async fetch(request: Request, tracing?: ExecutorHttpTracing): Promise<Response> {
      lifetime.signal.throwIfAborted();
      request.signal.throwIfAborted();
      const id = randomId();
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, lifetime.signal, controller.signal]);
      const finish = () => {
        signal.removeEventListener("abort", finish);
        const entry = pending.get(id);
        pending.delete(id);
        controller.abort();
        if (entry && !entry.body.locked) void entry.body.cancel().catch(() => {});
      };
      signal.addEventListener("abort", finish, { once: true });
      let iterator: AsyncIterableIterator<JsonValue> | undefined;
      try {
        const traceparent = parseTraceparent(tracing?.traceparent)
          ? tracing!.traceparent
          : undefined;
        const onRecords = traceparent ? tracing?.onRecords : undefined;
        const input = parse(getRequestSchema(), {
          id,
          url: request.url,
          method: request.method,
          headers: headerPairs(
            createApplicationRequestHeaders(copyHeaders(request.headers), headerOptions),
          ),
          body: request.body !== null,
          ...(traceparent ? { traceparent } : {}),
        });
        if (request.body) pending.set(id, { body: request.body, claimed: false, signal });
        iterator = channelForGeneration().stream("http.request", input, { signal });
        const first = await iterator.next();
        if (first.done) throw invalid();
        const head = parse(getHeadSchema(), first.value);
        if (head.body && (request.method === "HEAD" || [204, 205, 304].includes(head.status))) {
          throw invalid();
        }
        const headers = copyHeaders(head.headers);
        const frames = responseBodyFrames(iterator, onRecords);
        if (!head.body) {
          if (!(await frames.next()).done) throw invalid();
          finish();
          return new Response(null, { status: head.status, statusText: head.statusText, headers });
        }
        return new Response(decodedBody(frames, finish), {
          status: head.status,
          statusText: head.statusText,
          headers,
        });
      } catch (error) {
        finish();
        void iterator?.return?.().catch(() => {});
        throw error;
      }
    },
    async close(): Promise<void> {
      lifetime.abort();
      for (const entry of pending.values()) {
        if (!entry.body.locked) void entry.body.cancel().catch(() => {});
      }
      pending.clear();
      const channel = channelForGeneration();
      channel.close();
      await channel.settled;
    },
  };
}

/** Install only after the existing owner/source/installation checks succeed. */
export function createExecutorHttpOperation(
  options: BoundChannel & {
    /** Trusted project/environment identity from the authenticated HTTP installation. */
    traceIdentity?: { projectId: string; environmentId: string };
    /** The handler is already bound to this installation's immutable project source. */
    handle(request: Request): Response | Promise<Response>;
  },
): ExecutorOperation {
  const binding = parse(getExecutorBindingSchema(), options.binding);
  const channelForGeneration = options.channel;
  const handle = options.handle;
  const traceIdentity = options.traceIdentity && { ...options.traceIdentity };
  return {
    mode: "stream",
    async *handle(value, context) {
      assertBinding(binding, context);
      const input = parse(getRequestSchema(), value);
      const url = new URL(input.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw invalid();
      }
      const upload = input.body
        ? channelForGeneration().stream("http.request-body", { id: input.id }, {
          signal: context.signal,
        })
        : undefined;
      let response: Response | undefined;
      const recorder = createWorkerTraceRecorder(input.traceparent);
      const run = <T>(operation: () => T): T => {
        const scoped = () =>
          traceIdentity ? runWithExecutorHttpTraceScope(traceIdentity, operation) : operation();
        return recorder ? recorder.run(scoped) : runWithProjectTraceProvider(undefined, scoped);
      };
      try {
        const init: RequestInit & { duplex?: "half" } = {
          method: input.method,
          headers: createApplicationRequestHeaders(copyHeaders(input.headers)),
          signal: context.signal,
          ...(upload ? { body: decodedBody(upload, () => {}), duplex: "half" as const } : {}),
        };
        response = await run(() => handle(new Request(url, init)));
        context.signal.throwIfAborted();
        const body = response.body !== null && input.method !== "HEAD" &&
          ![204, 205, 304].includes(response.status);
        yield parse(getHeadSchema(), {
          type: "head",
          status: response.status,
          statusText: response.statusText,
          headers: headerPairs(response.headers),
          body,
        });
        if (body) yield* bodyChunks(response.body!, context.signal, run);
        if (recorder) yield { type: "traces", records: recorder.finish() };
      } finally {
        recorder?.finish();
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
        await upload?.return?.().catch(() => {});
      }
    },
  };
}
