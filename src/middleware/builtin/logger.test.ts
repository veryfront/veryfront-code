import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { devLogger, logger, prodLogger } from "./logger.ts";
import { MiddlewareContext } from "../core/context.ts";
import { HTTP_SERVER_ERROR } from "@veryfront/utils";

describe("logger", () => {
  it("should log request with dev format by default", async () => {
    let logMessage = "";
    const middleware = logger({
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("GET"), true);
    assertEquals(logMessage.includes("/test"), true);
    assertEquals(logMessage.includes("200"), true);
  });

  it("should log with combined format", async () => {
    let logMessage = "";
    const middleware = logger({
      format: "combined",
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        "user-agent": "test-agent",
        "referer": "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("test-agent"), true);
    assertEquals(logMessage.includes("http://example.com"), true);
  });

  it("should log with common format", async () => {
    let logMessage = "";
    const middleware = logger({
      format: "common",
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("GET"), true);
    assertEquals(logMessage.includes("/test"), true);
  });

  it("should log with short format", async () => {
    let logMessage = "";
    const middleware = logger({
      format: "short",
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("GET /test 200"), true);
    assertEquals(logMessage.includes("192.168.1.1"), true);
  });

  it("should log with tiny format", async () => {
    let logMessage = "";
    const middleware = logger({
      format: "tiny",
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("GET /test 200"), true);
  });

  it("should skip logging when skip function returns true", async () => {
    let logMessage = "";
    const middleware = logger({
      skip: (req) => req.url.includes("skip-me"),
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/skip-me");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertEquals(logMessage, "");
  });

  it("should not skip logging when skip function returns false", async () => {
    let logMessage = "";
    const middleware = logger({
      skip: (req) => req.url.includes("skip-me"),
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/log-me");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("log-me"), true);
  });

  it("should log duration", async () => {
    let logMessage = "";
    const middleware = logger({
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("OK", { status: 200 });
    };

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("ms") || logMessage.includes("s"), true);
  });

  it("should log error when response is undefined", async () => {
    let logMessage = "";
    const middleware = logger({
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(undefined);

    await middleware(ctx, next);

    assertExists(logMessage);
    assertEquals(logMessage.includes("[ERROR]"), true);
    assertEquals(logMessage.includes(String(HTTP_SERVER_ERROR)), true);
  });

  it("should log error when next throws", async () => {
    let logMessage = "";
    const middleware = logger({
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => {
      throw new Error("Test error");
    };

    try {
      await middleware(ctx, next);
    } catch {
      // Expected
    }

    assertExists(logMessage);
    assertEquals(logMessage.includes("[ERROR]"), true);
  });

  it("should use x-real-ip header for remote address", async () => {
    let logMessage = "";
    const middleware = logger({
      format: "short",
      log: (msg: string) => {
        logMessage = msg;
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        "x-real-ip": "10.0.0.1",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    assertEquals(logMessage.includes("10.0.0.1"), true);
  });
});

describe("devLogger", () => {
  it("should create logger with dev format", async () => {
    let logMessage = "";
    const middleware = devLogger();
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    // Dev format should be applied (can't test exact format due to colors)
  });
});

describe("prodLogger", () => {
  it("should create logger with combined format", async () => {
    let logMessage = "";
    const middleware = prodLogger();
    const req = new Request("http://localhost/test", {
      headers: {
        "user-agent": "test-agent",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    await middleware(ctx, next);

    // Combined format should be applied
  });
});
