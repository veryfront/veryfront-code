import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createUpstreamFailureResponse,
  createUpstreamTimeoutResponse,
} from "./upstream-error-response.ts";

describe("proxy upstream error responses", () => {
  it("creates a gateway timeout response with the configured timeout", async () => {
    const response = createUpstreamTimeoutResponse(12_345);

    assertEquals(response.status, 504);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Gateway Timeout",
      message: "Server request timed out after 12345ms",
    });
  });

  it("creates a proxy failure response from an upstream error", async () => {
    const response = createUpstreamFailureResponse(new Error("connection refused"));

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      error: "Proxy Error",
      message: "connection refused",
    });
  });

  it("uses a stable fallback message for non-Error upstream failures", async () => {
    const response = createUpstreamFailureResponse("bad failure");

    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: "Proxy Error",
      message: "Unknown error",
    });
  });
});
