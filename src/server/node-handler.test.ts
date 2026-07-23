import { assertEquals } from "#veryfront/testing/assert.ts";
import { toNodeHandler } from "./node-handler.ts";

type FakeRes = {
  statusCode?: number;
  statusMessage?: string;
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  writeHeadHeaders?: Record<string, unknown>;
  setHeaderCalls: Array<[string, unknown]>;
  chunks: Uint8Array[];
  ended: boolean;
  writeBackpressureOnce: boolean;
  backpressureActive: boolean;
  backpressureViolation: boolean;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  setHeader(name: string, value: unknown): void;
  write(chunk: Uint8Array): boolean;
  end(body?: string): void;
  on(event: string, listener: () => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  destroy(): void;
};

function createFakeRes(options: { writeBackpressureOnce?: boolean } = {}): FakeRes {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const response: FakeRes = {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    setHeaderCalls: [],
    chunks: [],
    ended: false,
    writeBackpressureOnce: options.writeBackpressureOnce ?? false,
    backpressureActive: false,
    backpressureViolation: false,
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
      if (this.backpressureActive) this.backpressureViolation = true;
      this.headersSent = true;
      this.chunks.push(chunk);
      if (this.writeBackpressureOnce) {
        this.writeBackpressureOnce = false;
        this.backpressureActive = true;
        queueMicrotask(() => {
          this.backpressureActive = false;
          this.emit("drain");
        });
        return false;
      }
      return true;
    },
    end(_body) {
      this.ended = true;
      this.writableEnded = true;
    },
    on(event, listener) {
      const registered = listeners.get(event) ?? new Set();
      registered.add(listener);
      listeners.set(event, registered);
    },
    once(event, listener) {
      const wrapped = (...args: unknown[]) => {
        this.off(event, wrapped);
        listener(...args);
      };
      this.on(event, wrapped);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
    destroy() {
      this.destroyed = true;
    },
  };
  return response;
}

function createFakeReq(
  init: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
): import("node:http").IncomingMessage & { emitTestEvent(event: string): void } {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    method: init.method ?? "GET",
    url: init.url ?? "/",
    headers: { host: "localhost", ...(init.headers ?? {}) },
    on(event: string, listener: (...args: unknown[]) => void) {
      const registered = listeners.get(event) ?? new Set();
      registered.add(listener);
      listeners.set(event, registered);
      return this;
    },
    pause() {
      return this;
    },
    resume() {
      return this;
    },
    destroy() {
      return this;
    },
    emitTestEvent(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
  } as unknown as import("node:http").IncomingMessage & { emitTestEvent(event: string): void };
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

Deno.test("toNodeHandler does not write response bodies for HEAD requests", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("must-not-be-written"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const nodeHandler = toNodeHandler(() => new Response(body));
  const res = createFakeRes();

  await nodeHandler(
    createFakeReq({ method: "HEAD", url: "/" }),
    res as unknown as import("node:http").ServerResponse,
  );

  assertEquals(res.chunks.length, 0);
  assertEquals(res.ended, true);
  assertEquals(cancelled, true);
});

Deno.test("toNodeHandler honors Node response backpressure", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.enqueue(new Uint8Array([2]));
      controller.close();
    },
  });
  const nodeHandler = toNodeHandler(() => new Response(body));
  const res = createFakeRes({ writeBackpressureOnce: true });

  await nodeHandler(
    createFakeReq({ url: "/" }),
    res as unknown as import("node:http").ServerResponse,
  );

  assertEquals(res.chunks.length, 2);
  assertEquals(res.backpressureViolation, false);
});

Deno.test("toNodeHandler destroys a partial response when streaming fails", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      if (reads === 1) controller.enqueue(new Uint8Array([1]));
      else controller.error(new Error("stream failed"));
    },
  });
  const nodeHandler = toNodeHandler(() => new Response(body));
  const res = createFakeRes();

  await nodeHandler(
    createFakeReq({ url: "/" }),
    res as unknown as import("node:http").ServerResponse,
  );

  assertEquals(res.statusCode, 200);
  assertEquals(res.destroyed, true);
});

Deno.test("toNodeHandler propagates client aborts to the Web Request", async () => {
  let requestSignal: AbortSignal | undefined;
  let releaseHandler: (() => void) | undefined;
  const waitForRelease = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });
  const nodeHandler = toNodeHandler(async (request) => {
    requestSignal = request.signal;
    await waitForRelease;
    return new Response("ok");
  });
  const req = createFakeReq({ url: "/" });
  const res = createFakeRes();

  const pending = nodeHandler(req, res as unknown as import("node:http").ServerResponse);
  await Promise.resolve();
  req.emitTestEvent("aborted");

  assertEquals(requestSignal?.aborted, true);
  releaseHandler?.();
  await pending;
});
