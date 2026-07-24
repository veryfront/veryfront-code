import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONFIG_PARSE_ERROR, SERVICE_OVERLOADED } from "#veryfront/errors";
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

    it("preserves registered client-error status as problem details", async () => {
      const handler = async (): Promise<Response> => {
        throw CONFIG_PARSE_ERROR.create({
          detail: "Rejected hosted configuration source",
        });
      };

      const { response, error } = await withRequestTimeout(handler, "/config", "GET");
      const body = await response.json();

      assertEquals(response.status, 400);
      assertEquals(response.headers.get("content-type"), "application/problem+json");
      assertEquals(body.type, "https://veryfront.com/docs/errors/config-parse-error");
      assertEquals(body.status, 400);
      assertEquals(body.detail, "Rejected hosted configuration source");
      assertExists(error);
    });

    it("preserves retryable registered service status without leaking detail", async () => {
      const handler = async (): Promise<Response> => {
        throw SERVICE_OVERLOADED.create({
          detail: "Evaluator worker pool unavailable: tenant-specific diagnostic",
        });
      };

      const { response, error } = await withRequestTimeout(handler, "/config", "GET");
      const body = await response.json();

      assertEquals(response.status, 503);
      assertEquals(response.headers.get("content-type"), "application/problem+json");
      assertEquals(body.type, "https://veryfront.com/docs/errors/service-overloaded");
      assertEquals(body.status, 503);
      assertEquals("detail" in body, false);
      assertExists(error);
    });

    it("returns error wrapper when a handler throws before returning a promise", async () => {
      const handler = (): Promise<Response> => {
        throw new Error("Synchronous handler failure");
      };

      const { response, error, settled } = await withRequestTimeout(handler, "/test", "GET");
      await settled;

      assertEquals(response.status, 500);
      assertExists(error);
      assertEquals(error.message, "Synchronous handler failure");
    });

    it("aborts the handler signal on timeout and reports settlement separately", async () => {
      let releaseHandler!: () => void;
      let handlerSignal: AbortSignal | undefined;
      const handler = (signal: AbortSignal): Promise<Response> => {
        handlerSignal = signal;
        return new Promise<Response>((resolve) => {
          releaseHandler = () => resolve(new Response("late response"));
        });
      };

      const { response, settled } = await withRequestTimeout(handler, "/test", "GET", {
        timeoutMs: 1,
      });

      assertEquals(response.status, HTTP_GATEWAY_TIMEOUT);
      assertEquals(handlerSignal?.aborted, true);

      let didSettle = false;
      void settled.then(() => {
        didSettle = true;
      });
      await Promise.resolve();
      assertEquals(didSettle, false);

      releaseHandler();
      await settled;
      assertEquals(didSettle, true);
    });

    it("preserves cancellation from the inbound request signal", async () => {
      const parentController = new AbortController();
      let handlerSignal: AbortSignal | undefined;
      const responsePromise = withRequestTimeout(
        (signal) => {
          handlerSignal = signal;
          return Promise.resolve(new Response("ok"));
        },
        "/test",
        "GET",
        { signal: parentController.signal },
      );

      parentController.abort("client disconnected");
      const { response } = await responsePromise;

      assertEquals(response.status, 200);
      assertEquals(handlerSignal?.aborted, true);
      assertEquals(handlerSignal?.reason, "client disconnected");
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
  });

  describe("timeout response format", () => {
    // Test that the timeout response structure matches expected format
    // by verifying the HTTP_GATEWAY_TIMEOUT constant is correct
    it("uses 504 Gateway Timeout status", () => {
      assertEquals(HTTP_GATEWAY_TIMEOUT, 504);
    });
  });
});
