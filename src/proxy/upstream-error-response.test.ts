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

  it("returns a generic body that does not leak the upstream error message", async () => {
    const response = createUpstreamFailureResponse(new Error("connection refused to internal-host:5432"));

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    // The real error is logged server-side; the client body must stay generic.
    assertEquals(await response.json(), {
      error: "Bad Gateway",
      message: "Bad Gateway",
    });
  });

  it("uses the same generic body for non-Error upstream failures", async () => {
    const response = createUpstreamFailureResponse("bad failure");

    assertEquals(response.status, 502);
    assertEquals(await response.json(), {
      error: "Bad Gateway",
      message: "Bad Gateway",
    });
  });
});
