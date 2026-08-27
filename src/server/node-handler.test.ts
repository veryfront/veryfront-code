import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isRequestFromLoopbackPeer } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { toNodeHandler } from "./node-handler.ts";

type FakeRes = {
  statusCode?: number;
  headersSent: boolean;
  writeHeadHeaders?: Record<string, unknown>;
  setHeaderCalls: Array<[string, unknown]>;
  chunks: Uint8Array[];
  ended: boolean;
  endBody?: string;
  destroyed: boolean;
  destroyError?: unknown;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  setHeader(name: string, value: unknown): void;
  write(chunk: Uint8Array): void;
  end(body?: string): void;
  destroy(error?: unknown): void;
  on(event: string, listener: () => void): void;
};

function createFakeRes(): FakeRes {
  return {
    headersSent: false,
    setHeaderCalls: [],
    chunks: [],
    ended: false,
    destroyed: false,
    writeHead(status, headers) {
      // Mirror Node: the head can only be written once, and never after
      // headers have already been flushed.
      if (this.headersSent) throw new Error("ERR_HTTP_HEADERS_SENT");
      this.statusCode = status;
      this.writeHeadHeaders = headers;
      this.headersSent = true;
    },
    setHeader(name, value) {
      // Mirror Node: headers cannot be mutated once they have been sent.
      if (this.headersSent) throw new Error("ERR_HTTP_HEADERS_SENT");
      this.setHeaderCalls.push([name, value]);
    },
    write(chunk) {
      this.chunks.push(chunk);
    },
    end(body) {
      this.ended = true;
      this.endBody = body;
    },
    destroy(error) {
      // Mirror Node: the socket is torn down without a terminating chunk, so
      // the peer sees an incomplete message rather than a complete response.
      this.destroyed = true;
      this.destroyError = error;
    },
    on(_event, _listener) {
      // no-op: close-handler registration is not exercised in unit tests
    },
  };
}

function createFakeReq(
  init: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    remoteAddress?: string;
  },
): import("node:http").IncomingMessage {
  return {
    method: init.method ?? "GET",
    url: init.url ?? "/",
    headers: { host: "localhost", ...(init.headers ?? {}) },
    socket: { remoteAddress: init.remoteAddress },
  } as unknown as import("node:http").IncomingMessage;
}

/**
 * Serve one request through the listener and wait for the response.
 *
 * toNodeHandler returns a synchronous listener that fires the request without
 * awaiting it, mirroring Node, which ignores whatever a request listener
 * returns. The response settling is what marks the work done.
 */
async function runRequest(
  nodeHandler: ReturnType<typeof toNodeHandler>,
  req: import("node:http").IncomingMessage,
  res: FakeRes,
): Promise<void> {
  nodeHandler(req, res as unknown as import("node:http").ServerResponse);
  // Poll for a terminal state rather than awaiting a promise the response never
  // resolves: a regression that stops the response terminating then fails this
  // one case by name, instead of hanging the suite and skipping every later
  // step. Polling also leaves no promise pending when the run ends.
  const deadline = Date.now() + 5_000;
  while (!res.ended && !res.destroyed) {
    if (Date.now() > deadline) {
      throw new Error("response was never ended or destroyed within 5s");
    }
    await tick();
  }
}

/** Yield a macrotask turn, for a request that settles no response at all. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function decodeBody(res: FakeRes): string {
  const total = res.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of res.chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function collectSetCookies(res: FakeRes): string[] {
  // Prefer setHeader("Set-Cookie", [...]) emission.
  const cookies: string[] = [];
  for (const [name, value] of res.setHeaderCalls) {
    if (name.toLowerCase() === "set-cookie") {
      if (Array.isArray(value)) cookies.push(...(value as string[]));
      else cookies.push(String(value));
    }
  }
  // Fall back to writeHead headers (single comma-joined value triggers failure).
  const headers = res.writeHeadHeaders;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "set-cookie") {
        const value = headers[key];
        if (Array.isArray(value)) cookies.push(...(value as string[]));
        else cookies.push(String(value));
      }
    }
  }
  return cookies;
}

describe("toNodeHandler", () => {
  it("preserves multiple Set-Cookie headers as distinct values", async () => {
    const handler = () => {
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1; Path=/");
      headers.append("Set-Cookie", "b=2; Path=/");
      return new Response("ok", { status: 200, headers });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ url: "/" }), res);

    const cookies = collectSetCookies(res);
    assertEquals(cookies.length, 2);
    assertEquals(cookies.includes("a=1; Path=/"), true);
    assertEquals(cookies.includes("b=2; Path=/"), true);

    // The response body must actually be pumped into the Node response.
    assertEquals(res.chunks.length > 0, true, "body chunks must reach res.write");
    assertEquals(
      decodeBody(res),
      "ok",
      "the Response body must be pumped into the Node response",
    );
  });

  it("does not throw when a Headers adapter omits getSetCookie", async () => {
    // Simulate a compatible Headers adapter that omits getSetCookie. We wrap a
    // real Headers in a Proxy that hides getSetCookie
    // while still exposing an iterator that yields each Set-Cookie as a distinct
    // entry (matching undici's iteration behaviour). A real Response is returned
    // but with its `headers` accessor pointed at the legacy-like object.
    const realHeaders = new Headers();
    realHeaders.append("Set-Cookie", "a=1; Path=/");
    realHeaders.append("Set-Cookie", "b=2; Path=/");
    realHeaders.set("content-type", "text/plain");

    const legacyHeaders = new Proxy(realHeaders, {
      get(target, prop, receiver) {
        // Pretend getSetCookie does not exist on this runtime.
        if (prop === "getSetCookie") return undefined;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as Headers;

    const handler = () => {
      const response = new Response("ok", { status: 200 });
      Object.defineProperty(response, "headers", {
        get: () => legacyHeaders,
        configurable: true,
      });
      return response;
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ url: "/" }), res);

    // Must not have fallen into the catch block and emitted a 500.
    assertEquals(res.statusCode, 200);
    assertEquals(res.ended, true);

    // Fallback preserves both cookies when the iterator exposes them separately.
    const cookies = collectSetCookies(res);
    assertEquals(cookies.length, 2);
    assertEquals(cookies.includes("a=1; Path=/"), true);
    assertEquals(cookies.includes("b=2; Path=/"), true);
  });

  it("passes array-valued request headers through to the Request", async () => {
    let seen: string | null = null;
    const handler = (req: Request) => {
      seen = req.headers.get("x-multi");
      return new Response("ok", { status: 200 });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(
      nodeHandler,
      createFakeReq({ url: "/", headers: { "x-multi": ["one", "two"] } }),
      res,
    );

    // A collapsed-to-first-element bug would yield only "one".
    assertEquals(seen, "one, two");
  });

  it("records the native socket peer on the Web Request", async () => {
    let sawLoopbackPeer = false;
    const handler = (req: Request) => {
      sawLoopbackPeer = isRequestFromLoopbackPeer(req);
      return new Response("ok", { status: 200 });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(
      nodeHandler,
      createFakeReq({ url: "/_projects", remoteAddress: "127.0.0.1" }),
      res,
    );

    assertEquals(sawLoopbackPeer, true);
  });

  it("streams a POST request body into the Web Request", async () => {
    // A Node IncomingMessage is an async-iterable stream, so the adapter has to
    // forward it as the Request body (which also requires duplex: "half").
    const req = Object.assign(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":1}'));
          controller.close();
        },
      }),
      {
        method: "POST",
        url: "/api",
        headers: { host: "localhost", "content-type": "application/json" },
        socket: {},
      },
    ) as unknown as import("node:http").IncomingMessage;

    let seen: string | null = null;
    const handler = async (request: Request) => {
      seen = await request.text();
      return new Response("ok", { status: 200 });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, req, res);

    assertEquals(
      res.statusCode,
      200,
      "a POST with a stream body must not fall into the 500 catch block",
    );
    assertEquals(
      seen,
      '{"a":1}',
      "toNodeHandler must stream the Node request body into the Web Request for non-GET methods",
    );
  });

  it("gives a HEAD request a null body", async () => {
    let sawBody: ReadableStream<Uint8Array> | null = null;
    let sawMethod: string | null = null;
    const handler = (request: Request) => {
      sawBody = request.body;
      sawMethod = request.method;
      return new Response(null, { status: 200 });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ method: "HEAD", url: "/" }), res);

    assertEquals(sawMethod, "HEAD", "the request method must be forwarded unchanged");
    assertEquals(sawBody, null, "a HEAD request must reach the handler with a null body");
  });

  it("leaves the socket untouched for a 101 upgrade response", async () => {
    // Response cannot be constructed with a 1xx status, so mirror an upgrade
    // response by overriding the status accessor.
    const handler = () => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "status", { get: () => 101, configurable: true });
      return response;
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    // The handler returns without touching the response, so there is nothing
    // to settle on: let the in-flight request finish, then assert it did nothing.
    nodeHandler(
      createFakeReq({ url: "/ws" }),
      res as unknown as import("node:http").ServerResponse,
    );
    await tick();

    assertEquals(
      res.headersSent,
      false,
      "a 101 upgrade must not write a head onto the upgraded socket",
    );
    assertEquals(res.statusCode, undefined, "a 101 upgrade must not set a response status");
    assertEquals(res.ended, false, "a 101 upgrade must not end the upgraded socket");
  });

  it("answers a thrown handler with a 500 and an error payload", async () => {
    const handler = () => {
      throw new Error("handler exploded");
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ url: "/boom" }), res);

    assertEquals(res.statusCode, 500, "a handler failure must be served as a 500");
    assertEquals(res.ended, true, "a failed request must still be ended");
    assertEquals(
      res.endBody,
      "Internal Server Error",
      "a handler failure must send the Internal Server Error payload",
    );
    assertEquals(
      res.destroyed,
      false,
      "a failure before the head is flushed must be reportable as a 500, not a torn-down socket",
    );
  });

  it("destroys the response when the body stream fails after the head is sent", async () => {
    const streamError = new Error("stream exploded");
    const handler = () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // A partial body reaches the peer before the failure.
          controller.enqueue(new TextEncoder().encode("partial"));
        },
        pull(controller) {
          controller.error(streamError);
        },
      });
      return new Response(body, { status: 200, headers: { "content-length": "20" } });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ url: "/stream" }), res);

    // The 200 head is already on the wire, so the failure cannot be reported
    // in the status line any more.
    assertEquals(res.statusCode, 200);
    assertEquals(res.headersSent, true);
    assertEquals(decodeBody(res), "partial", "only the pre-failure chunks were written");

    assertEquals(
      res.ended,
      false,
      "ending would emit the terminating chunk and the peer would read the truncated body as a complete 2xx",
    );
    assertEquals(
      res.destroyed,
      true,
      "a mid-stream failure must tear the response down so the peer sees an incomplete message",
    );
    assertEquals(res.destroyError, streamError, "destroy must carry the original failure");
  });

  it("destroys with an Error when the mid-stream failure is not an Error", async () => {
    const handler = () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error("plain string failure");
        },
      });
      return new Response(body, { status: 200 });
    };

    const nodeHandler = toNodeHandler(handler);
    const res = createFakeRes();
    await runRequest(nodeHandler, createFakeReq({ url: "/stream" }), res);

    assertEquals(res.destroyed, true);
    assertEquals(res.ended, false);
    // res.destroy() expects an Error; a raw string would be rejected by Node.
    assertInstanceOf(res.destroyError, Error);
    assertStringIncludes((res.destroyError as Error).message, "plain string failure");
  });
});
