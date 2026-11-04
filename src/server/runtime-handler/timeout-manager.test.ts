import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PERMISSION_DENIED } from "#veryfront/errors";
import { HTTP_GATEWAY_TIMEOUT } from "./request-utils.ts";
import { withRequestTimeout } from "./timeout-manager.ts";

import { ControlPlaneRequestError } from "#veryfront/internal-agents/control-plane-auth.ts";
import { InternalAgentRequestBodyTooLargeError } from "#veryfront/internal-agents/request-body.ts";

describe("timeout-manager", () => {
  describe("withRequestTimeout", () => {
    it("does not report expected execute ingress rejections as application faults", async () => {
      for (
        const failure of [
          new ControlPlaneRequestError(400, "Invalid project run execute request"),
          new ControlPlaneRequestError(401, "Invalid control-plane signature"),
          new InternalAgentRequestBodyTooLargeError(),
        ]
      ) {
        const { response, error } = await withRequestTimeout(
          async () => {
            throw failure;
          },
          "/api/control-plane/runs/run/execute",
          "POST",
        );
        assertEquals(response.status, failure.status);
        assertEquals(await response.json(), { error: failure.message });
        assertEquals(error, undefined);
      }
    });

    it("keeps typed ingress errors opaque outside execute and ignores arbitrary status", async () => {
      for (
        const [path, method, failure] of [
          ["/other", "POST", new ControlPlaneRequestError(401, "private detail")],
          [
            "/api/control-plane/runs/run/execute",
            "GET",
            new ControlPlaneRequestError(401, "private detail"),
          ],
          [
            "/api/control-plane/runs/run/execute",
            "POST",
            Object.assign(new Error("private detail"), { status: 401 }),
          ],
        ] as const
      ) {
        const { response, error } = await withRequestTimeout(
          async () => {
            throw failure;
          },
          path,
          method,
        );
        assertEquals(response.status, 500);
        assertExists(error);
        assertEquals((await response.text()).includes("private detail"), false);
      }
    });

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
        throw new Error("Handler failed at /srv/secret/path?token=abc");
      };

      const { response, error } = await withRequestTimeout(handler, "/test", "GET");

      assertEquals(response.status, 500);
      assertExists(error);
      assertEquals(error.message, "Handler failed at /srv/secret/path?token=abc");
      assertEquals(
        response.headers.get("content-type"),
        "text/html; charset=utf-8",
        "unknown exceptions must keep the opaque HTML error page",
      );
      const html = await response.text();
      assertEquals(
        html.includes("Handler failed"),
        false,
        "the internal exception message must never reach the client",
      );
      assertEquals(html.length > 0, true, "the opaque page must still have a body");
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

    it("preserves registered env authorization errors at the outer request boundary", async () => {
      const registeredError = PERMISSION_DENIED.create({
        detail: "Project credential is not authorized for the requested environment",
      });
      const handler = async (): Promise<Response> => {
        throw registeredError;
      };

      const { response, error } = await withRequestTimeout(
        handler,
        "/hosted-project",
        "GET",
      );

      assertEquals(error, registeredError);
      assertEquals(response.status, 403);
      assertEquals(response.headers.get("content-type"), "application/problem+json");
      assertEquals(await response.json(), {
        type: "https://veryfront.com/docs/code/guides/errors#permission-denied",
        title: "File/resource permission denied",
        status: 403,
        detail: "Project credential is not authorized for the requested environment",
        instance: "/hosted-project",
        category: "GENERAL",
        suggestion: "Check file permissions and access rights",
      });
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

    it("keeps the drain promise pending until an opted-in response body settles", async () => {
      let release: (() => void) | undefined;
      const responsePromise = withRequestTimeout(
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new TextEncoder().encode("prefix"));
                  release = () => controller.close();
                },
              }, { highWaterMark: 0 }),
            ),
          ),
        "/hosted",
        "GET",
        { settleResponseBody: true },
      );
      const { response, settled } = await responsePromise;
      const reader = response.body!.getReader();
      await reader.read();
      let didSettle = false;
      void settled.then(() => {
        didSettle = true;
      });
      await Promise.resolve();
      assertEquals(didSettle, false);
      release!();
      await reader.read();
      await settled;
      assertEquals(didSettle, true);
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
