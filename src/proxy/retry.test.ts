import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  getFramedRequestBody,
  getUpstreamRetryCount,
  isRetryableConnectionError,
} from "./retry.ts";

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

  it("returns false for timeout errors", () => {
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
});

describe("getUpstreamRetryCount", () => {
  it("retries idempotent requests", () => {
    assertEquals(getUpstreamRetryCount("GET", "/", new Headers(), 1), 1);
    assertEquals(getUpstreamRetryCount("HEAD", "/", new Headers(), 2), 2);
  });

  it("does not retry ordinary POST requests", () => {
    assertEquals(getUpstreamRetryCount("POST", "/api/submit", new Headers(), 1), 0);
  });

  it("retries bodyless control-plane run stream POST requests", () => {
    assertEquals(
      getUpstreamRetryCount("POST", "/api/control-plane/runs/run_1/stream", new Headers(), 1),
      1,
    );
  });

  it("retries control-plane run stream POST requests with explicit zero content length", () => {
    assertEquals(
      getUpstreamRetryCount(
        "POST",
        "/api/control-plane/runs/run_1/stream",
        new Headers({ "content-length": "0" }),
        1,
      ),
      1,
    );
  });

  it("does not retry control-plane run stream POST requests with a body", () => {
    assertEquals(
      getUpstreamRetryCount(
        "POST",
        "/api/control-plane/runs/run_1/stream",
        new Headers({ "content-length": "1" }),
        1,
      ),
      0,
    );
    assertEquals(
      getUpstreamRetryCount(
        "POST",
        "/api/control-plane/runs/run_1/stream",
        new Headers({ "transfer-encoding": "chunked" }),
        1,
      ),
      0,
    );
  });
});

describe("getFramedRequestBody", () => {
  function createBody(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  }

  it("drops Deno-style empty POST streams when content length is zero", () => {
    const body = createBody();

    assertEquals(
      getFramedRequestBody(new Headers({ "content-length": "0" }), body),
      null,
    );
  });

  it("preserves request streams when body framing is present", () => {
    const body = createBody();

    assertEquals(
      getFramedRequestBody(new Headers({ "content-length": "1" }), body),
      body,
    );
    assertEquals(
      getFramedRequestBody(new Headers({ "transfer-encoding": "chunked" }), body),
      body,
    );
  });
});
