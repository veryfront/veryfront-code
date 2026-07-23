import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Readable } from "node:stream";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";

/**
 * Build a mock that mirrors a Node `http.IncomingMessage`: a readable stream
 * carrying body bytes, plus the `method`/`headers` properties.
 */
function createMockReq(
  method: string,
  headers: Record<string, string | string[]>,
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

  it("should not attach a body stream for bodyless POST requests", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("POST", {}) as never,
      "http://localhost/api/control-plane/runs/run_1/stream",
    );

    assertEquals(result.method, "POST");
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

  it("should preserve every value from array-valued headers", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("GET", { "x-multi": ["one", "two"] }) as never,
      "http://localhost/test",
    );

    assertEquals(result.headers.get("x-multi"), "one, two");
  });
});
