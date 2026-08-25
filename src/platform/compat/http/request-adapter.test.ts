import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { Readable } from "node:stream";
import { buildNodeRequestInit, convertNodeRequestToWebRequest } from "./request-adapter.ts";

/**
 * Build a mock that mirrors a Node `http.IncomingMessage`: a readable stream
 * carrying body bytes, plus the `method`/`headers` properties.
 */
function createMockReq(
  method: string,
  headers: Record<string, string>,
  bodyChunks: string[] = [],
) {
  const stream = Readable.from(
    bodyChunks.map((chunk) => new TextEncoder().encode(chunk)),
  );
  return Object.assign(stream, { method, headers });
}

describe("convertNodeRequestToWebRequest", () => {
  it("should export the function", () => {
    assertExists(convertNodeRequestToWebRequest);
    assertEquals(typeof convertNodeRequestToWebRequest, "function");
  });

  it("should convert a GET request with no body", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("GET", { "content-type": "application/json" }) as never,
      "http://localhost/test",
    );

    assertExists(result);
    assertEquals(result.method, "GET");
    assertEquals(result.url, "http://localhost/test");
    assertEquals(result.body, null);
  });

  it("should not attach a body for HEAD requests", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("HEAD", {}) as never,
      "http://localhost/test",
    );

    assertEquals(result.method, "HEAD");
    assertEquals(result.body, null);
  });

  it("should not attach a body for OPTIONS (CORS preflight) requests", () => {
    // Regression test: OPTIONS previously hit the body path and threw the
    // undici `duplex` TypeError, surfacing as a 500 on every preflight.
    const result = convertNodeRequestToWebRequest(
      createMockReq("OPTIONS", {}) as never,
      "http://localhost/mcp",
    );

    assertEquals(result.method, "OPTIONS");
    assertEquals(result.body, null);
  });

  it("should attach a readable streaming body for POST requests", async () => {
    // Regression test for the missing `duplex: "half"` option: constructing a
    // Request with a stream body must not throw, and the body must be readable.
    const result = convertNodeRequestToWebRequest(
      createMockReq(
        "POST",
        { "content-type": "application/json", "content-length": "38" },
        ['{"jsonrpc":"2.0",', '"method":"initialize"}'],
      ) as never,
      "http://localhost/mcp",
    );

    assertExists(result);
    assertEquals(result.method, "POST");
    assertExists(result.body);
    assertEquals(await result.text(), '{"jsonrpc":"2.0","method":"initialize"}');
  });

  it("sets duplex: half only when a streaming body is attached", () => {
    const withBody = buildNodeRequestInit(
      createMockReq("POST", { "content-length": "3" }, ["abc"]) as never,
    );
    assertEquals(
      withBody.duplex,
      "half",
      "streaming bodies must set duplex: half so undici accepts them",
    );

    const bodyless = buildNodeRequestInit(createMockReq("GET", {}) as never);
    assertEquals(bodyless.duplex, undefined, "bodyless requests must not set duplex");
  });

  it("should not attach a body stream for bodyless POST requests", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("POST", {}) as never,
      "http://localhost/api/control-plane/runs/run_1/stream",
    );

    assertEquals(result.method, "POST");
    assertEquals(result.body, null);
  });

  it("treats a whitespace-padded zero content length as bodyless", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("POST", { "content-length": " 0 " }) as never,
      "http://localhost/api/control-plane/runs/run_1/stream",
    );

    assertEquals(result.body, null);
  });

  it("should attach a body stream for chunked POST requests", async () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("POST", { "transfer-encoding": "chunked" }, ["chunk"]) as never,
      "http://localhost/mcp",
    );

    assertExists(result.body);
    assertEquals(await result.text(), "chunk");
  });

  it("pauses the Node request when the stream queue fills and resumes on pull", async () => {
    const req = createMockReq("POST", { "transfer-encoding": "chunked" }, ["a", "b"]);
    let pauseCalls = 0;
    let resumeCalls = 0;
    const origPause = req.pause.bind(req);
    const origResume = req.resume.bind(req);
    req.pause = () => {
      pauseCalls++;
      return origPause();
    };
    req.resume = () => {
      resumeCalls++;
      return origResume();
    };

    // No reader is attached yet, so the first enqueue fills the default
    // one-chunk queue and must pause the Node request.
    const result = convertNodeRequestToWebRequest(req as never, "http://localhost/mcp");
    await waitFor(() => pauseCalls > 0, {
      message: "a full stream queue must pause the Node request",
    });
    assertEquals(pauseCalls > 0, true, "a full stream queue must pause the Node request");

    assertEquals(await result.text(), "ab", "the paused body must still drain fully");
    assertEquals(resumeCalls > 1, true, "the consumer's pull must resume the Node request");
  });

  it("should preserve headers", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("GET", {
        "x-custom-header": "custom-value",
        authorization: "Bearer token",
      }) as never,
      "http://localhost/test",
    );

    assertEquals(result.headers.get("x-custom-header"), "custom-value");
    assertEquals(result.headers.get("authorization"), "Bearer token");
  });

  it("destroys the Node request when the web body consumer cancels", async () => {
    const stream = new Readable({
      read() {
        // Keep the request open until cancellation.
      },
    });
    const request = Object.assign(stream, {
      method: "POST",
      headers: { "content-length": "10" },
    });
    const result = convertNodeRequestToWebRequest(
      request as never,
      "http://localhost/upload",
    );

    await result.body?.cancel("consumer stopped reading");

    assertEquals(stream.destroyed, true);
  });

  it("rejects the web body when the Node request closes prematurely", async () => {
    const stream = new Readable({
      read() {
        // Keep the request open until the simulated disconnect.
      },
    });
    const request = Object.assign(stream, {
      method: "POST",
      headers: { "content-length": "10" },
    });
    const result = convertNodeRequestToWebRequest(
      request as never,
      "http://localhost/upload",
    );
    const reader = result.body!.getReader();
    const readOutcome = reader.read().then(
      () => "resolved",
      () => "rejected",
    );

    stream.destroy();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      readOutcome,
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), 100);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (outcome === "timeout") await reader.cancel();

    assertEquals(outcome, "rejected");
  });
});
