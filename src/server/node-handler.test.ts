import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { EventEmitter } from "node:events";
import { toNodeHandler } from "./node-handler.ts";

class FakeRes extends EventEmitter {
  statusCode?: number;
  statusMessage = "";
  headersSent = false;
  writeHeadHeaders?: Record<string, unknown>;
  setHeaderCalls: Array<[string, unknown]> = [];
  chunks: Uint8Array[] = [];
  ended = false;
  writableEnded = false;
  destroyed = false;
  destroyedError?: Error;
  writeHeadCalls = 0;
  headerMutationAfterSendAttempts = 0;
  writeOutcomes: boolean[] = [];

  writeHead(status: number, headers?: Record<string, unknown>): void {
    this.writeHeadCalls++;
    if (this.headersSent) {
      this.headerMutationAfterSendAttempts++;
      throw new Error("ERR_HTTP_HEADERS_SENT");
    }
    this.statusCode = status;
    this.writeHeadHeaders = headers;
    this.headersSent = true;
  }

  setHeader(name: string, value: unknown): void {
    if (this.headersSent) {
      this.headerMutationAfterSendAttempts++;
      throw new Error("ERR_HTTP_HEADERS_SENT");
    }
    this.setHeaderCalls.push([name, value]);
  }

  write(chunk: Uint8Array): boolean {
    this.headersSent = true;
    this.chunks.push(chunk);
    return this.writeOutcomes.shift() ?? true;
  }

  end(_body?: string): void {
    this.headersSent = true;
    this.ended = true;
    this.writableEnded = true;
  }

  destroy(error?: Error): this {
    this.destroyed = true;
    this.destroyedError = error;
    return this;
  }
}

function createFakeRes(): FakeRes {
  return new FakeRes();
}

function createFakeReq(
  init: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
): import("node:http").IncomingMessage {
  return Object.assign(new EventEmitter(), {
    method: init.method ?? "GET",
    url: init.url ?? "/",
    headers: { host: "localhost", ...(init.headers ?? {}) },
  }) as unknown as import("node:http").IncomingMessage;
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

Deno.test("toNodeHandler preserves multiple Set-Cookie headers as distinct values", async () => {
  const handler = () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1; Path=/");
    headers.append("Set-Cookie", "b=2; Path=/");
    return new Response("ok", { status: 200, headers });
  };

  const nodeHandler = toNodeHandler(handler);
  const res = createFakeRes();
  await nodeHandler(
    createFakeReq({ url: "/" }),
    res as unknown as import("node:http").ServerResponse,
  );

  const cookies = collectSetCookies(res);
  assertEquals(cookies.length, 2);
  assertEquals(cookies.includes("a=1; Path=/"), true);
  assertEquals(cookies.includes("b=2; Path=/"), true);
});

Deno.test("toNodeHandler does not throw when getSetCookie is unavailable (early Node 18)", async () => {
  // Simulate a runtime whose Headers predates Headers.prototype.getSetCookie
  // (Node < ~18.14). We wrap a real Headers in a Proxy that hides getSetCookie
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
  await nodeHandler(
    createFakeReq({ url: "/" }),
    res as unknown as import("node:http").ServerResponse,
  );

  // Must not have fallen into the catch block and emitted a 500.
  assertEquals(res.statusCode, 200);
  assertEquals(res.ended, true);

  // Fallback preserves both cookies when the iterator exposes them separately.
  const cookies = collectSetCookies(res);
  assertEquals(cookies.length, 2);
  assertEquals(cookies.includes("a=1; Path=/"), true);
  assertEquals(cookies.includes("b=2; Path=/"), true);
});

Deno.test("toNodeHandler passes array-valued request headers through to the Request", async () => {
  let seen: string | null = null;
  const handler = (req: Request) => {
    seen = req.headers.get("x-multi");
    return new Response("ok", { status: 200 });
  };

  const nodeHandler = toNodeHandler(handler);
  const res = createFakeRes();
  await nodeHandler(
    createFakeReq({ url: "/", headers: { "x-multi": ["one", "two"] } }),
    res as unknown as import("node:http").ServerResponse,
  );

  // A collapsed-to-first-element bug would yield only "one".
  assertEquals(seen, "one, two");
});

Deno.test("toNodeHandler aborts the Web request when the Node client disconnects", async () => {
  let finishHandler!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finishHandler = resolve;
  });
  let requestSignal: AbortSignal | undefined;
  const nodeHandler = toNodeHandler((request) => {
    requestSignal = request.signal;
    return response;
  });
  const req = createFakeReq({ url: "/slow" });
  const res = createFakeRes();

  const completion = nodeHandler(
    req,
    res as unknown as import("node:http").ServerResponse,
  ) as unknown as Promise<void>;
  req.emit("aborted");
  const disconnected = requestSignal?.aborted ?? false;
  finishHandler(new Response("late"));
  await completion;

  assertEquals(disconnected, true);
  assertEquals(res.chunks.length, 0);
});

Deno.test("toNodeHandler waits for drain after Node response backpressure", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.enqueue(new Uint8Array([2]));
      controller.close();
    },
  });
  const nodeHandler = toNodeHandler(() => new Response(stream));
  const res = createFakeRes();
  res.writeOutcomes.push(false, true);

  const completion = nodeHandler(
    createFakeReq({ url: "/stream" }),
    res as unknown as import("node:http").ServerResponse,
  ) as unknown as Promise<void>;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(res.chunks.length, 1);
  res.emit("drain");
  await completion;
  assertEquals(res.chunks.length, 2);
  assertEquals(res.ended, true);
});

Deno.test("toNodeHandler destroys a streaming response that fails after headers", async () => {
  const streamError = new Error("stream failed after headers");
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (pulls === 1) {
        controller.enqueue(new Uint8Array([1]));
        return;
      }
      controller.error(streamError);
    },
  });
  const nodeHandler = toNodeHandler(() => new Response(stream));
  const res = createFakeRes();
  let completionError: unknown;

  await (nodeHandler(
    createFakeReq({ url: "/stream-error" }),
    res as unknown as import("node:http").ServerResponse,
  ) as unknown as Promise<void>).catch((error) => {
    completionError = error;
  });

  assertEquals(completionError, undefined);
  assertEquals(res.headerMutationAfterSendAttempts, 0);
  assertEquals(res.destroyed, true);
  assertStrictEquals(res.destroyedError, streamError);
});
