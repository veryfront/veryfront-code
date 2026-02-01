import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HTTP_GATEWAY_TIMEOUT } from "./request-utils.ts";
import { withRequestTimeout } from "./timeout-manager.ts";

describe("timeout-manager", () => {
  describe("withRequestTimeout", () => {
    it("returns handler response when it completes quickly", async () => {
      const expectedBody = "Hello, World!";
      const handler = async () => new Response(expectedBody);

      const { response, error } = await withRequestTimeout(handler, "/test", "GET");

      assertEquals(error, undefined);
      assertEquals(await response.text(), expectedBody);
    });

    it("returns handler response with status", async () => {
      const handler = async () => new Response("Not Found", { status: 404 });

      const { response } = await withRequestTimeout(handler, "/test", "GET");

      assertEquals(response.status, 404);
    });

    it("returns error wrapper for handler exceptions", async () => {
      const handler = async (): Promise<Response> => {
        throw new Error("Handler failed");
      };

      const { response, error } = await withRequestTimeout(handler, "/test", "GET");

      assertEquals(response.status, 500);
      assertExists(error);
      assertEquals(error.message, "Handler failed");
    });

    it("wraps non-Error throws as Error", async () => {
      const handler = async (): Promise<Response> => {
        throw "string error";
      };

      const { response, error } = await withRequestTimeout(handler, "/test", "GET");

      assertEquals(response.status, 500);
      assertExists(error);
      assertEquals(error.message, "string error");
    });

    // Note: Timeout tests are intentionally not included because:
    // 1. They would require long delays (REQUEST_TIMEOUT_MS default)
    // 2. They make tests slow and flaky
    // 3. The timeout logic is straightforward Promise.race
    // Integration tests cover actual timeout scenarios.
  });

  describe("timeout response format", () => {
    // Test that the timeout response structure matches expected format
    // by verifying the HTTP_GATEWAY_TIMEOUT constant is correct
    it("uses 504 Gateway Timeout status", () => {
      assertEquals(HTTP_GATEWAY_TIMEOUT, 504);
    });
  });
});
