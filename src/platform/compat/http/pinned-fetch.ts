/**
 * Dependency-free Node/Bun HTTP transport that connects only to DNS addresses
 * already validated by the host egress policy while preserving the original
 * Host header and TLS SNI name.
 */

import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import type { Readable } from "node:stream";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import { isErrorAcrossRealms } from "../error-introspection.ts";

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Client identity for guarded egress, standing in for the runtime-supplied
 * `user-agent` (`node`, `Deno/x.y.z`) that this transport cannot inherit.
 */
export const DEFAULT_OUTBOUND_USER_AGENT = `veryfront/${VERSION}`;

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
  if (!headers.has("accept")) headers.set("accept", "*/*");
  if (!headers.has("accept-language")) headers.set("accept-language", "*");
  if (!headers.has("accept-encoding")) {
    // A compressed byte range is ambiguous to decode, so the runtime asks for
    // `identity` whenever the caller requested a range.
    headers.set(
      "accept-encoding",
      headers.has("range") ? "identity" : DEFAULT_ACCEPT_ENCODING,
    );
  }
  // Fetch metadata reports the request mode; it is not always `cors`.
  if (!headers.has("sec-fetch-mode")) headers.set("sec-fetch-mode", mode ?? "cors");
  if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_OUTBOUND_USER_AGENT);
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

function createPinnedLookup(addresses: readonly string[]): RequestOptions["lookup"] {
  let nextIndex = 0;
  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const requestedFamily = typeof options === "number"
      ? options
      : typeof options === "object" && options !== null && "family" in options
      ? Number((options as { family?: unknown }).family ?? 0)
      : 0;
    const candidates = addresses.filter((address) =>
      requestedFamily === 0 || addressFamily(address) === requestedFamily
    );
    if (candidates.length === 0) {
      callback(new Error("No validated address matches the requested address family"));
      return;
    }
    const wantsAll = typeof options === "object" && options !== null &&
      (options as { all?: unknown }).all === true;
    if (wantsAll) {
      callback(
        null,
        candidates.map((address) => ({ address, family: addressFamily(address) })),
      );
      return;
    }
    const address = candidates[nextIndex++ % candidates.length]!;
    callback(null, address, addressFamily(address));
  }) as RequestOptions["lookup"];
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
 * The first attempt offers the whole set, which is what `autoSelectFamily`
 * consumes on runtimes that implement it. Bun does not implement it, so a host
 * whose DNS carries an unreachable family (an AAAA record with no IPv6 route,
 * for instance) fails outright instead of falling through. The follow-up
 * attempts pin one address each so the walk happens here rather than depending
 * on the runtime, and a different family is tried before a sibling of the one
 * that just failed.
 *
 * Every address is already validated by the egress policy, so trying them in
 * turn narrows nothing: the set is identical, only the order of use changes.
 */
export function planPinnedConnectAttempts(
  addresses: readonly string[],
): readonly (readonly string[])[] {
  if (addresses.length <= 1) return [addresses];
  const first = addresses[0]!;
  const otherFamily = addresses.filter((address) =>
    addressFamily(address) !== addressFamily(first)
  );
  const sameFamily = addresses.slice(1).filter((address) =>
    addressFamily(address) === addressFamily(first)
  );
  return [addresses, ...[...otherFamily, ...sameFamily].map((address) => [address])];
}

/** True when the request may be issued again against a different address. */
export function isRetriableConnectFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RETRIABLE_CONNECT_CODES.has(code);
}

/**
 * A body may only be replayed when re-reading it yields the same bytes. Blob
 * and ReadableStream bodies reach the wire through `Readable.fromWeb`, which
 * consumes them, so a second attempt would send nothing.
 */
export function isReplayableRequestBody(body: BodyInit | null): boolean {
  return body === null || typeof body === "string" ||
    body instanceof URLSearchParams || body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body);
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
  const body = init.body ?? null;
  if (body instanceof URLSearchParams && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (body instanceof Blob && body.type && !headers.has("content-type")) {
    headers.set("content-type", body.type);
  } else if (typeof FormData !== "undefined" && body instanceof FormData) {
    const normalized = new Request(url, {
      method: init.method ?? "POST",
      headers,
      body,
    });
    const normalizedHeaders = new Headers(normalized.headers);
    for (const [name, value] of normalizedHeaders) headers.set(name, value);
    return new Uint8Array(await normalized.arrayBuffer());
  }
  return body;
}

async function writeRequestBody(request: ClientRequest, body: BodyInit | null): Promise<void> {
  if (body === null) {
    request.end();
    return;
  }
  if (typeof body === "string" || body instanceof URLSearchParams) {
    request.end(String(body));
    return;
  }
  if (body instanceof ArrayBuffer) {
    request.end(new Uint8Array(body));
    return;
  }
  if (ArrayBuffer.isView(body)) {
    request.end(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    return;
  }

  const { Readable } = await import("node:stream");
  const webStream = body instanceof Blob ? body.stream() : body;
  const source = Readable.fromWeb(
    webStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  await new Promise<void>((resolve, reject) => {
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
): Promise<Response> {
  if (addresses.length === 0) {
    throw new Error(`No validated addresses are available for ${url.host}`);
  }
  const headers = applyRuntimeDefaultRequestHeaders(new Headers(init.headers), init.mode);
  const body = await normalizeRequestBody(url, init, headers);
  const method = (init.method ?? "GET").toUpperCase();
  const requestHeaders: Record<string, string> = {};
  for (const [name, value] of headers) requestHeaders[name] = value;

  const transport = url.protocol === "https:"
    ? await import("node:https")
    : await import("node:http");
  const attempts = planPinnedConnectAttempts(addresses);
  const bodyIsReplayable = isReplayableRequestBody(body);
  let lastConnectError: unknown;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const requestOptions: RequestOptions & { autoSelectFamily?: boolean } = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: requestHeaders,
      lookup: createPinnedLookup(attempts[attemptIndex]!),
      // Let Node/Bun race the complete validated address set instead of binding
      // availability to whichever A/AAAA record happened to be returned first.
      // Bun ignores this, which is why the loop above also walks the addresses.
      autoSelectFamily: true,
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    };

    try {
      return await new Promise<Response>((resolve, reject) => {
        let settled = false;
        let responseMessage: IncomingMessage | undefined;
        const cleanupAbortListener = () => init.signal?.removeEventListener("abort", abort);
        const rejectBeforeResponse = (error: unknown) => {
          cleanupAbortListener();
          reject(error);
        };
        const request = transport.request(requestOptions, async (message) => {
          responseMessage = message;
          try {
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

        const abort = () => {
          const reason = init.signal?.reason ??
            new DOMException("The operation was aborted", "AbortError");
          responseMessage?.destroy(isErrorAcrossRealms(reason) ? reason : undefined);
          request.destroy(isErrorAcrossRealms(reason) ? reason : undefined);
          if (!settled) rejectBeforeResponse(reason);
        };
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) {
          abort();
          return;
        }
        request.once("error", rejectBeforeResponse);
        void writeRequestBody(request, body).catch((error) => request.destroy(error));
      });
    } catch (error) {
      lastConnectError = error;
      const hasAnotherAddress = attemptIndex < attempts.length - 1;
      if (
        !hasAnotherAddress || !bodyIsReplayable || init.signal?.aborted ||
        !isRetriableConnectFailure(error)
      ) {
        throw error;
      }
    }
  }

  throw lastConnectError;
}
