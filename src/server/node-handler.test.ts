import { assertEquals } from "#veryfront/testing/assert.ts";
import { toNodeHandler } from "./node-handler.ts";

type FakeRes = {
  statusCode?: number;
  headersSent: boolean;
  writeHeadHeaders?: Record<string, unknown>;
  setHeaderCalls: Array<[string, unknown]>;
  chunks: Uint8Array[];
  ended: boolean;
  writeHead(status: number, headers?: Record<string, unknown>): void;
  setHeader(name: string, value: unknown): void;
  write(chunk: Uint8Array): void;
  end(body?: string): void;
};

function createFakeRes(): FakeRes {
  return {
    headersSent: false,
    setHeaderCalls: [],
    chunks: [],
    ended: false,
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
    end(_body) {
      this.ended = true;
    },
  };
}

function createFakeReq(
  init: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
): import("node:http").IncomingMessage {
  return {
    method: init.method ?? "GET",
    url: init.url ?? "/",
    headers: { host: "localhost", ...(init.headers ?? {}) },
  } as unknown as import("node:http").IncomingMessage;
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
