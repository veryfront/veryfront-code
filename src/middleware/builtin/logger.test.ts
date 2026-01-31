import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { devLogger, logger, prodLogger } from "./logger.ts";

function makeCtx(
  url = "http://localhost/api/data",
  headers: Record<string, string> = {},
): { request: Request; req: Request } {
  const req = new Request(url, { headers });
  return { request: req, req };
}

function nextOk(): Promise<Response> {
  return Promise.resolve(new Response("ok", { status: 200 }));
}

function next404(): Promise<Response> {
  return Promise.resolve(new Response("not found", { status: 404 }));
}

function next500(): Promise<Response> {
  return Promise.resolve(new Response("error", { status: 500 }));
}

function getFirstLog(logs: string[]): string {
  const entry = logs[0];
  assertExists(entry);
  return entry;
}

describe("middleware/builtin/logger", () => {
  describe("logger", () => {
    it("should pass through and return response unchanged", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "tiny", log: (msg) => logs.push(msg) });

      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.status, 200);
      assertEquals(logs.length, 1);
    });

    it("should log in tiny format", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "tiny", log: (msg) => logs.push(msg) });

      await mw(makeCtx("http://localhost/hello"), nextOk);

      assertEquals(logs.length, 1);
      const entry = getFirstLog(logs);
      assert(entry.includes("GET"));
      assert(entry.includes("/hello"));
      assert(entry.includes("200"));
    });

    it("should log in short format", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "short", log: (msg) => logs.push(msg) });

      await mw(
        makeCtx("http://localhost/test", { "x-forwarded-for": "1.2.3.4" }),
        nextOk,
      );

      assertEquals(logs.length, 1);
      const entry = getFirstLog(logs);
      assert(entry.includes("GET"));
      assert(entry.includes("/test"));
      assert(entry.includes("200"));
      assert(entry.includes("1.2.3.4"));
    });

    it("should log in common format", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "common", log: (msg) => logs.push(msg) });

      await mw(makeCtx("http://localhost/page"), nextOk);

      assertEquals(logs.length, 1);
      const entry = getFirstLog(logs);
      assert(entry.includes("GET /page HTTP/1.1"));
      assert(entry.includes("200"));
    });

    it("should log in combined format", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "combined", log: (msg) => logs.push(msg) });

      await mw(
        makeCtx("http://localhost/page", {
          "user-agent": "TestAgent/1.0",
          referer: "http://example.com",
        }),
        nextOk,
      );

      assertEquals(logs.length, 1);
      const entry = getFirstLog(logs);
      assert(entry.includes("TestAgent/1.0"));
      assert(entry.includes("http://example.com"));
      assert(entry.includes("GET /page HTTP/1.1"));
    });

    it("should log in dev format with color codes", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "dev", log: (msg) => logs.push(msg) });

      await mw(makeCtx("http://localhost/api"), nextOk);

      assertEquals(logs.length, 1);
      const entry = getFirstLog(logs);
      assert(entry.includes("GET"));
      assert(entry.includes("/api"));
      assert(entry.includes("200"));
    });

    it("should log in json format", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(
        makeCtx("http://localhost/api/data", {
          "user-agent": "TestBot/2.0",
          "x-request-id": "req-123",
          "x-trace-id": "trace-456",
          "x-project-slug": "my-project",
          referer: "http://ref.com",
          "x-forwarded-for": "10.0.0.1",
        }),
        next404,
      );

      assertEquals(logs.length, 1);
      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.level, "warn");
      assertEquals(entry.service, "server");
      assertEquals(entry.http.method, "GET");
      assertEquals(entry.http.path, "/api/data");
      assertEquals(entry.http.status, 404);
      assertEquals(entry.http.remoteAddr, "10.0.0.1");
      assertEquals(entry.http.userAgent, "TestBot/2.0");
      assertEquals(entry.http.referer, "http://ref.com");
      assertEquals(entry.requestId, "req-123");
      assertEquals(entry.traceId, "trace-456");
      assertEquals(entry.projectSlug, "my-project");
      assert(typeof entry.http.durationMs === "number");
    });

    it("should set json level to error for 5xx", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(makeCtx(), next500);

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.level, "error");
    });

    it("should set json level to info for 2xx", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(makeCtx(), nextOk);

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.level, "info");
    });

    it("should skip logging when skip function returns true", async () => {
      const logs: string[] = [];
      const mw = logger({
        format: "tiny",
        skip: (req) => new URL(req.url).pathname === "/health",
        log: (msg) => logs.push(msg),
      });

      const res = await mw(makeCtx("http://localhost/health"), nextOk);

      assertEquals(res?.status, 200);
      assertEquals(logs.length, 0);
    });

    it("should not skip when skip function returns false", async () => {
      const logs: string[] = [];
      const mw = logger({
        format: "tiny",
        skip: () => false,
        log: (msg) => logs.push(msg),
      });

      await mw(makeCtx(), nextOk);

      assertEquals(logs.length, 1);
    });

    it("should log 500 when next returns undefined", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      const res = await mw(makeCtx(), () => Promise.resolve(undefined));

      assertEquals(res, undefined);
      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.http.status, 500);
      assertEquals(entry.level, "error");
    });

    it("should log 500 and rethrow when next throws", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      let caught: Error | undefined;
      try {
        await mw(makeCtx(), () => Promise.reject(new Error("boom")));
      } catch (e) {
        caught = e instanceof Error ? e : new Error(String(e));
      }

      assertEquals(caught?.message, "boom");
      assertEquals(logs.length, 1);
      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.http.status, 500);
    });

    it("should use x-real-ip when x-forwarded-for is absent", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(
        makeCtx("http://localhost/", { "x-real-ip": "192.168.1.1" }),
        nextOk,
      );

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.http.remoteAddr, "192.168.1.1");
    });

    it("should use - when no remote address headers present", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(makeCtx(), nextOk);

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.http.remoteAddr, "-");
    });

    it("should omit optional json fields when headers absent", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(makeCtx(), nextOk);

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.requestId, undefined);
      assertEquals(entry.traceId, undefined);
      assertEquals(entry.projectSlug, undefined);
      assertEquals(entry.http.userAgent, undefined);
      assertEquals(entry.http.referer, undefined);
    });

    it("should use traceparent header as traceId fallback", async () => {
      const logs: string[] = [];
      const mw = logger({ format: "json", log: (msg) => logs.push(msg) });

      await mw(makeCtx("http://localhost/", { traceparent: "00-abc-def-01" }), nextOk);

      const entry = JSON.parse(getFirstLog(logs));
      assertEquals(entry.traceId, "00-abc-def-01");
    });

    it("should default to dev format when no options", async () => {
      const logs: string[] = [];
      const mw = logger({ log: (msg) => logs.push(msg) });

      await mw(makeCtx("http://localhost/test"), nextOk);

      assertEquals(logs.length, 1);
      assert(getFirstLog(logs).includes("\x1b["));
    });
  });

  describe("devLogger", () => {
    it("should create a logger with dev format", async () => {
      const mw = devLogger();

      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.status, 200);
    });
  });

  describe("prodLogger", () => {
    it("should create a logger with json format", async () => {
      const mw = prodLogger();

      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.status, 200);
    });
  });
});
