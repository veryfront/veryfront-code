import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  readVeryfrontApiResponse,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import {
  parseEventDiscoveryV1,
  parseEventErrorV1,
  parseRunReadMemberV1,
  parseRunReadPageV1,
  parseStreamMemberV1,
} from "#veryfront/events/canonical-v1/index.ts";
import type {
  EventDiscoveryV1,
  RunReadMemberV1,
  RunReadPageV1,
  StreamMemberV1,
} from "#veryfront/events/canonical-v1/index.ts";
import { MAX_SSE_FRAME_CHARS, normalizeNewlines } from "#veryfront/utils/sse-frames.ts";
import type { RunsCallOptions } from "./client.ts";

export interface CanonicalEventsV1ListOptions {
  cursor?: string;
  after_event_id?: number;
  sort_order?: "asc" | "desc";
  limit?: number;
  event_type?: string[];
  include_descendants?: boolean;
  start?: string;
  end?: string;
  span_id?: string;
  turn_id?: string;
  search?: string;
  event_class?: "fact" | "delta";
  is_error?: boolean;
}
export interface CanonicalEventsV1Facade {
  list(
    runId: string,
    query?: CanonicalEventsV1ListOptions,
    options?: RunsCallOptions,
  ): Promise<RunReadPageV1>;
  get(runId: string, eventId: string, options?: RunsCallOptions): Promise<RunReadMemberV1>;
  discover(options?: RunsCallOptions): Promise<EventDiscoveryV1>;
  stream(
    runId: string,
    lastEventId?: string,
    options?: RunsCallOptions,
  ): AsyncIterable<StreamMemberV1>;
}
/** A failed canonical-v1 HTTP operation, retaining its content-free error code. */
export class CanonicalEventsV1Error extends VeryfrontError {
  constructor(
    status: number,
    readonly problem: { code: string; message: string; event_ids?: number[] },
  ) {
    super(problem.message, { ...API_CLIENT_ERROR, status, context: { problem } });
    this.name = "CanonicalEventsV1Error";
  }
}
/** Transport error frames throw instead of looking like a successful end of history. */
export class CanonicalEventsV1StreamError extends Error {
  constructor(readonly problem: unknown) {
    super("canonical-v1 stream failed");
    this.name = "CanonicalEventsV1StreamError";
  }
}
function path(runId: string, suffix: string): string {
  return `/runs/${locator(runId)}/${suffix}?event_representation=canonical-v1`;
}

function locator(value: string): string {
  if (!value.trim()) throw new TypeError("Run ID must not be empty");
  return encodeURIComponent(value);
}
function cursor(value: string, zero = false): void {
  if (
    !(zero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("Invalid canonical-v1 cursor");
  }
}
function assertRequestedRunIdentity(member: RunReadMemberV1 | StreamMemberV1, runId: string): void {
  const returnedRunId = member.kind === "transient" ? member.event.runid : member.metadata.run_id;
  if (returnedRunId !== runId) throw new TypeError("canonical-v1 run identity mismatch");
}

export function createCanonicalEventsV1Facade(
  transport: VeryfrontApiTransport<unknown>,
): CanonicalEventsV1Facade {
  async function request(
    path: string,
    options: RunsCallOptions = {},
    stream = false,
    lastEventId?: string,
  ): Promise<unknown> {
    const headers = new Headers({ Accept: stream ? "text/event-stream" : "application/json" });
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);

    let successHeaders: Headers | undefined;
    const result = await transport.request(path, {
      method: "GET",
      headers,
      signal: options.signal,
      maxResponseBytes: options.maxResponseBytes,
      onResponse: async (response, init, url, responseSignal) => {
        const signal = responseSignal ?? options.signal ?? new AbortController().signal;
        if (!response.ok) {
          const reader = response.body?.getReader();
          if (!reader) throw new TypeError("canonical-v1 error has no response body");
          const abort = () => {
            void reader.cancel(signal.reason).catch(() => {});
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let text = "";
          let bytes = 0;
          try {
            while (true) {
              signal.throwIfAborted();
              const part = await reader.read();
              signal.throwIfAborted();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 64 * 1024) throw new TypeError("canonical-v1 error body is too large");
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            signal.removeEventListener("abort", abort);
            await reader.cancel();
            reader.releaseLock();
          }
          const problem = await parseEventErrorV1(JSON.parse(text));
          throw new CanonicalEventsV1Error(response.status, problem);
        }
        successHeaders = response.headers;
        if (response.ok && stream) return response;
        return await readVeryfrontApiResponse(response, init, url, signal);
      },
    });
    try {
      if (successHeaders) options.onHeaders?.(successHeaders);
    } catch (error) {
      if (stream && result instanceof Response) {
        try {
          await result.body?.cancel(error);
        } catch { /* Keep the caller's exception. */ }
      }
      throw error;
    }
    return result;
  }
  return {
    async list(runId, query = {}, options) {
      if (query.cursor !== undefined) cursor(query.cursor);
      if (query.after_event_id !== undefined) {
        cursor(String(query.after_event_id), true);
        if (query.cursor !== undefined || query.sort_order === "desc") {
          throw new TypeError("after_event_id requires ascending reads without cursor");
        }
      }
      if (
        query.limit !== undefined &&
        (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)
      ) throw new TypeError("limit must be between 1 and 100");
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) { for (const item of value) params.append(key, item); }
        else if (value !== undefined) params.set(key, String(value));
      }
      const page = await parseRunReadPageV1(
        await request(`${path(runId, "events")}&${params}`, options),
      );
      if (query.include_descendants !== true) {
        for (const member of page.entries) assertRequestedRunIdentity(member, runId);
      }
      const ascending = query.sort_order !== "desc";
      let previous = query.cursor !== undefined ? Number(query.cursor) : query.after_event_id;
      for (const member of page.entries) {
        const id = member.metadata.event_id;
        if (previous !== undefined && (ascending ? id <= previous : id >= previous)) {
          throw new TypeError("List event IDs must advance in the requested order");
        }
        previous = id;
      }
      return page;
    },
    async get(runId, eventId, options) {
      cursor(eventId);
      const member = await parseRunReadMemberV1(
        await request(path(runId, `events/${eventId}`), options),
      );
      if (String(member.metadata.event_id) !== eventId) {
        throw new TypeError("canonical-v1 event identity mismatch");
      }
      assertRequestedRunIdentity(member, runId);
      return member;
    },
    async discover(options) {
      return await parseEventDiscoveryV1(
        await request("/runs/event-types?event_representation=canonical-v1", options),
      );
    },
    async *stream(runId, lastEventId = "0", options = {}) {
      cursor(lastEventId, true);
      const response = await request(path(runId, "stream"), options, true, lastEventId);
      if (!(response instanceof Response) || !response.body) {
        throw new TypeError("canonical-v1 stream has no response body");
      }
      let latestPersistedId = Number(lastEventId);
      for await (const member of readCanonicalMembers(response.body, options.signal)) {
        assertRequestedRunIdentity(member, runId);
        if (member.kind !== "transient") {
          if (member.metadata.event_id <= latestPersistedId) {
            throw new TypeError("Durable stream event ID must increase");
          }
          latestPersistedId = member.metadata.event_id;
        }
        yield member;
      }
    },
  };
}

async function decodeCanonicalSseFrame(frame: string): Promise<StreamMemberV1 | undefined> {
  let eventName = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }
  if (!data.length) {
    if (id !== undefined) {
      throw new TypeError("Control frame must not advance canonical-v1 cursor");
    }
    return undefined;
  }
  const value: unknown = JSON.parse(data.join("\n"));
  if (eventName === "error") {
    if (id !== undefined) throw new TypeError("Stream error must not carry a cursor");
    throw new CanonicalEventsV1StreamError(await parseEventErrorV1(value));
  }
  const member = await parseStreamMemberV1(value);
  const name = member.kind === "legacy" ? "legacy" : member.event.type;
  const expectedId = member.kind === "transient" ? undefined : String(member.metadata.event_id);
  if (eventName !== name || id !== expectedId) {
    throw new TypeError("canonical-v1 SSE identity mismatch");
  }
  return member;
}

async function* readCanonicalMembers(
  body: NonNullable<Response["body"]>,
  signal?: AbortSignal,
): AsyncGenerator<StreamMemberV1> {
  const reader = body.pipeThrough(new TextDecoderStream("utf-8", { fatal: true }), { signal })
    .getReader();
  let buffer = "";
  let pendingCR = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      let text = chunk.value ?? "";
      if (pendingCR) {
        text = "\r" + text;
        pendingCR = false;
      }
      if (!chunk.done && text.endsWith("\r")) {
        text = text.slice(0, -1);
        pendingCR = true;
      }
      buffer += normalizeNewlines(text);
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        signal?.throwIfAborted();
        const frame = buffer.slice(0, end);
        if (frame.length > MAX_SSE_FRAME_CHARS) {
          throw new TypeError("canonical-v1 SSE frame is too large");
        }
        buffer = buffer.slice(end + 2);
        const member = await decodeCanonicalSseFrame(frame);
        signal?.throwIfAborted();
        if (member !== undefined) yield member;
      }
      if (buffer.length > MAX_SSE_FRAME_CHARS) {
        throw new TypeError("canonical-v1 SSE frame is too large");
      }
      if (chunk.done) {
        if (buffer.trim()) throw new TypeError("Incomplete canonical-v1 SSE frame");
        break;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
