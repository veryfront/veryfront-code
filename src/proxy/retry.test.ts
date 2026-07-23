import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  getReplayableRequestBodies,
  getUpstreamRetryCount,
  isConnectionRefusedError,
  isRetryableConnectionError,
  shouldRetryUpstreamRequest,
} from "./retry.ts";

const RUN_STREAM_PATH = "/api/control-plane/runs/run_1/stream";
const RUN_STREAM_URL = `http://proxy.test${RUN_STREAM_PATH}`;

describe("isRetryableConnectionError", () => {
  it("returns false for non-Error values", () => {
    assertEquals(isRetryableConnectionError(null), false);
    assertEquals(isRetryableConnectionError(undefined), false);
    assertEquals(isRetryableConnectionError("string error"), false);
    assertEquals(isRetryableConnectionError(42), false);
  });

  it("returns true for connection reset errors", () => {
    assertEquals(isRetryableConnectionError(new Error("connection reset by peer")), true);
    assertEquals(
      isRetryableConnectionError(new Error("Connection reset by peer (os error 104)")),
      true,
    );
  });

  it("returns true for connection closed errors", () => {
    assertEquals(
      isRetryableConnectionError(new Error("connection closed before message completed")),
      true,
    );
    assertEquals(
      isRetryableConnectionError(new Error("client error (SendRequest): connection closed")),
      true,
    );
  });

  it("returns true for connection refused errors", () => {
    assertEquals(isRetryableConnectionError(new Error("connection refused")), true);
    assertEquals(
      isRetryableConnectionError(new Error("tcp connect error: Connection refused (os error 111)")),
      true,
    );
  });

  it("returns true for OS error codes", () => {
    assertEquals(isRetryableConnectionError(new Error("os error 104")), true);
    assertEquals(isRetryableConnectionError(new Error("os error 111")), true);
  });

  it("does not infer retryability from generic timeout messages", () => {
    assertEquals(isRetryableConnectionError(new Error("Request timeout")), false);
    assertEquals(isRetryableConnectionError(new Error("Gateway timeout")), false);
  });

  it("returns false for other errors", () => {
    assertEquals(isRetryableConnectionError(new Error("Not found")), false);
    assertEquals(isRetryableConnectionError(new Error("Internal server error")), false);
    assertEquals(isRetryableConnectionError(new TypeError("Cannot read property")), false);
  });

  it("handles real error messages from production logs", () => {
    // Actual error messages from production logs
    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request from 10.192.0.35:60358 for http://veryfront-server/ (10.193.189.155:80): client error (SendRequest): connection error: Connection reset by peer (os error 104)",
        ),
      ),
      true,
    );

    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request from 10.192.0.35:46166 for http://veryfront-server/ (10.193.189.155:80): client error (SendRequest): connection closed before message completed",
        ),
      ),
      true,
    );

    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request for url (http://veryfront-server/_vf_modules/components/Welcome.js): client error (Connect): tcp connect error: Connection refused (os error 111)",
        ),
      ),
      true,
    );
  });

  it("recognizes retryable codes in nested fetch causes", () => {
    const cause = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
    const error = new TypeError("fetch failed", { cause });
    const timeout = Object.assign(new Error("request failed"), { code: "ETIMEDOUT" });
    const refused = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });

    assertEquals(isRetryableConnectionError(error), true);
    assertEquals(isRetryableConnectionError(timeout), true);
    assertEquals(isConnectionRefusedError(new TypeError("fetch failed", { cause: refused })), true);
  });

  it("handles cyclic cause chains", () => {
    const error = new Error("fetch failed");
    Object.defineProperty(error, "cause", { value: error });

    assertEquals(isRetryableConnectionError(error), false);
    assertEquals(isConnectionRefusedError(error), false);
  });

  it("contains hostile error cause accessors", () => {
    const error = new Error("fetch failed");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("hostile cause getter");
      },
    });

    assertEquals(isRetryableConnectionError(error), false);
    assertEquals(isConnectionRefusedError(error), false);
  });
});

describe("getUpstreamRetryCount", () => {
  it("retries idempotent requests", () => {
    assertEquals(getUpstreamRetryCount(new Request("http://proxy.test/"), "/", 1), 1);
    assertEquals(
      getUpstreamRetryCount(
        new Request("http://proxy.test/", { method: "HEAD" }),
        "/",
        2,
      ),
      2,
    );
  });

  it("does not retry ordinary POST requests", () => {
    const request = new Request("http://proxy.test/api/submit", {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    });

    assertEquals(getUpstreamRetryCount(request, "/api/submit", 1), 0);
  });

  it("retries bounded signed control-plane run stream requests", () => {
    const request = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    });

    assertEquals(
      getUpstreamRetryCount(request, RUN_STREAM_PATH, 1),
      1,
    );
    assertEquals(
      getUpstreamRetryCount(request, RUN_STREAM_PATH, 3),
      1,
    );
  });

  it("keeps chunked, invalid, and oversized stream requests single-shot", () => {
    const requests = [
      new Request(RUN_STREAM_URL, {
        method: "POST",
        headers: { "transfer-encoding": "chunked" },
        body: "{}",
      }),
      new Request(RUN_STREAM_URL, {
        method: "POST",
        headers: { "content-length": "invalid" },
        body: "{}",
      }),
      new Request(RUN_STREAM_URL, {
        method: "POST",
        headers: { "content-length": String(DEFAULT_MAX_BODY_SIZE_BYTES + 1) },
        body: "{}",
      }),
    ];

    for (const request of requests) {
      assertEquals(getUpstreamRetryCount(request, RUN_STREAM_PATH, 1), 0);
    }
  });

  it("normalizes invalid and excessive retry counts", () => {
    const request = new Request("http://proxy.test/");
    assertEquals(getUpstreamRetryCount(request, "/", Number.NaN), 0);
    assertEquals(getUpstreamRetryCount(request, "/", Number.POSITIVE_INFINITY), 0);
    assertEquals(getUpstreamRetryCount(request, "/", 1.5), 0);
    assertEquals(getUpstreamRetryCount(request, "/", 1000), 10);
  });

  it("does not classify a request with a body and zero content length as bodyless", () => {
    const request = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "content-length": "0" },
      body: "{}",
    });

    assertEquals(getUpstreamRetryCount(request, RUN_STREAM_PATH, 1), 0);
  });
});

describe("shouldRetryUpstreamRequest", () => {
  it("retries a bounded stream invocation only when connection is refused", () => {
    const request = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    });

    assertEquals(
      shouldRetryUpstreamRequest(request, RUN_STREAM_PATH, new Error("connection refused")),
      true,
    );
    assertEquals(
      shouldRetryUpstreamRequest(request, RUN_STREAM_PATH, new Error("os error 111")),
      true,
    );
    assertEquals(
      shouldRetryUpstreamRequest(request, RUN_STREAM_PATH, new Error("connection reset")),
      false,
    );
    assertEquals(
      shouldRetryUpstreamRequest(request, RUN_STREAM_PATH, new Error("connection closed")),
      false,
    );
  });

  it("retains broad connection retries for bodyless idempotent requests", () => {
    const request = new Request("http://proxy.test/");
    assertEquals(
      shouldRetryUpstreamRequest(request, "/", new Error("connection reset")),
      true,
    );
  });

  it("never retries an ordinary POST", () => {
    const request = new Request("http://proxy.test/api/submit", {
      method: "POST",
      headers: { "content-length": "2" },
      body: "{}",
    });

    assertEquals(
      shouldRetryUpstreamRequest(request, "/api/submit", new Error("connection refused")),
      false,
    );
  });
});

describe("getReplayableRequestBodies", () => {
  it("creates an independent signed payload stream for every attempt", async () => {
    const payload = JSON.stringify({ run: { runId: "run_1" } });
    const request = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "content-length": String(payload.length) },
      body: payload,
    });

    const bodies = getReplayableRequestBodies(request, 2);

    assertEquals(bodies.length, 3);
    assertEquals(await new Response(bodies[0]).text(), payload);
    assertEquals(await new Response(bodies[1]).text(), payload);
    assertEquals(await new Response(bodies[2]).text(), payload);
  });

  it("keeps every bodyless attempt bodyless", () => {
    const request = new Request(RUN_STREAM_URL, {
      method: "POST",
      headers: { "content-length": "0" },
    });

    assertEquals(getReplayableRequestBodies(request, 1), [null, null]);
  });

  it("does not tee chunked or oversized request bodies", () => {
    const requests = [
      new Request(RUN_STREAM_URL, {
        method: "POST",
        headers: { "transfer-encoding": "chunked" },
        body: "{}",
      }),
      new Request(RUN_STREAM_URL, {
        method: "POST",
        headers: { "content-length": String(DEFAULT_MAX_BODY_SIZE_BYTES + 1) },
        body: "{}",
      }),
    ];

    for (const request of requests) {
      const bodies = getReplayableRequestBodies(request, 1);
      assertEquals(bodies.length, 1);
      assertEquals(bodies[0], request.body);
    }
  });
});
