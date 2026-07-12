import type { NodeIncomingMessage } from "./node-types.ts";

/** HTTP methods that never carry a request body. */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Convert a Node `http.IncomingMessage` into a WHATWG `Request`.
 *
 * A Node request is a readable stream of body bytes. When a streaming body is
 * supplied to the `Request` constructor (e.g. under Node's built-in fetch /
 * undici), the spec requires `duplex: "half"` — without it the constructor
 * throws `TypeError: RequestInit: duplex option is required when sending a
 * body.`, which previously surfaced as a generic 500 for every POST/PUT/etc.
 *
 * Bodyless methods (`GET`/`HEAD`/`OPTIONS`) must not attach a body at all;
 * `OPTIONS` in particular is used for CORS preflights and carries no body.
 */
export function convertNodeRequestToWebRequest(
  req: NodeIncomingMessage,
  url: string,
): Request {
  const method = req.method ?? "GET";
  const hasBody = requestCanCarryBody(method) && requestDeclaresBody(req.headers);

  // `duplex` is part of the WHATWG fetch spec but not yet in the lib.dom
  // `RequestInit` type, hence the intersection.
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: req.headers as HeadersInit,
  };

  if (hasBody) {
    init.body = nodeRequestToReadableStream(req);
    init.duplex = "half";
  }

  return new Request(url, init);
}

function requestCanCarryBody(method: string): boolean {
  return !BODYLESS_METHODS.has(method.toUpperCase());
}

function requestDeclaresBody(headers: NodeIncomingMessage["headers"]): boolean {
  const contentLengthHeader = headers["content-length"];
  const contentLength = Array.isArray(contentLengthHeader)
    ? contentLengthHeader.find((value) => value.trim().length > 0)
    : contentLengthHeader;
  if (contentLength !== undefined && contentLength.trim() !== "" && contentLength !== "0") {
    return true;
  }

  const transferEncodingHeader = headers["transfer-encoding"];
  const transferEncoding = Array.isArray(transferEncodingHeader)
    ? transferEncodingHeader.join(",")
    : transferEncodingHeader;

  return transferEncoding !== undefined && transferEncoding.trim() !== "";
}

/**
 * Adapt a Node readable request into a web `ReadableStream` using only the
 * event interface declared on {@link NodeIncomingMessage}, so this stays free
 * of a hard `node:stream` dependency (consistent with the rest of the compat
 * layer, which avoids static Node imports for non-Node runtimes).
 */
function nodeRequestToReadableStream(
  req: NodeIncomingMessage,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk) => {
        controller.enqueue(chunk);
        // Apply backpressure: once the stream's internal queue is full, pause
        // the Node request so it stops buffering the whole body in memory.
        if ((controller.desiredSize ?? 1) <= 0) req.pause?.();
      });
      req.on("end", () => controller.close());
      req.on("error", (error) => controller.error(error));
    },
    pull() {
      // The consumer asked for more — resume flowing mode.
      req.resume?.();
    },
  });
}
