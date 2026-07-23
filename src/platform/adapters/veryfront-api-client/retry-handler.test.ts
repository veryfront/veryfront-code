import "#veryfront/schemas/_test-setup.ts";
import { delay } from "#std/async.ts";
import { assertEquals, assertExists, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { requestWithRetry } from "./retry-handler.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
} from "#veryfront/observability/tracing/api-shim.ts";

const originalFetch = globalThis.fetch;

function setFetch(
  handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

async function captureVeryfrontError(
  fn: () => Promise<unknown>,
): Promise<VeryfrontError> {
  try {
    await fn();
  } catch (e) {
    return e as VeryfrontError;
  }
  throw new Error("Expected function to throw");
}

describe("retry-handler", () => {
  afterEach((): void => {
    globalThis.fetch = originalFetch;
    __resetLogRecordEmitterForTests();
    _resetShimForTests();
  });

  describe("requestWithRetry", () => {
    it("should export requestWithRetry function", (): void => {
      assertExists(requestWithRetry);
      assertEquals(typeof requestWithRetry, "function");
    });

    describe("trace context propagation", () => {
      let capturedHeaders: Headers | undefined;
      let capturedMethod: string | undefined;
      let capturedBody: BodyInit | null | undefined;

      beforeEach((): void => {
        capturedHeaders = undefined;
        capturedMethod = undefined;
        capturedBody = undefined;
        setFetch((_url, init) => {
          capturedHeaders = init?.headers as Headers | undefined;
          capturedMethod = init?.method;
          capturedBody = init?.body;
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });
      });

      it("should pass headers to fetch for trace context injection", async () => {
        await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 100, maxDelay: 1000 },
        );

        assertExists(capturedHeaders, "Headers should be passed to fetch");
        assertEquals(capturedHeaders.get("Authorization"), "Bearer test-token");
        assertEquals(capturedHeaders.get("Content-Type"), null);
      });

      it("should forward custom method, body, and headers", async () => {
        await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 100, maxDelay: 1000 },
          {
            method: "POST",
            body: JSON.stringify({ name: "job" }),
            headers: {
              "X-Test": "yes",
            },
          },
        );

        assertEquals(capturedMethod, "POST");
        assertEquals(capturedBody, JSON.stringify({ name: "job" }));
        assertExists(capturedHeaders, "Headers should be passed to fetch");
        assertEquals(capturedHeaders.get("Authorization"), "Bearer test-token");
        assertEquals(capturedHeaders.get("X-Test"), "yes");
        assertEquals(capturedHeaders.get("Content-Type"), "application/json");
      });

      it("does not override the runtime content type for FormData", async () => {
        const body = new FormData();
        body.set("name", "job");

        await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 100, maxDelay: 1000 },
          { method: "POST", body },
        );

        assertExists(capturedHeaders, "Headers should be passed to fetch");
        assertEquals(capturedHeaders.get("Content-Type"), null);
      });
    });

    describe("4xx error handling - no retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      async function expectNoRetry(
        status: number,
        statusText: string,
        body: string,
        token: string,
      ): Promise<void> {
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(new Response(body, { status, statusText }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            token,
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          )
        );

        assertEquals(fetchCallCount, 1, `Should only call fetch once - no retries for ${status}`);
        assertEquals(error.status, status);
      }

      it("should NOT retry 401 errors - fail fast for auth failures", async () => {
        await expectNoRetry(401, "Unauthorized", "Unauthorized", "invalid-token");
      });

      it("should NOT retry 403 errors", async () => {
        await expectNoRetry(403, "Forbidden", "Forbidden", "test-token");
      });

      it("should NOT retry 404 errors", async () => {
        await expectNoRetry(404, "Not Found", "Not Found", "test-token");
      });

      it("should NOT retry 400 errors", async () => {
        await expectNoRetry(400, "Bad Request", "Bad Request", "test-token");
      });

      it("does not expose response bodies or URL credentials in errors or logs", async () => {
        const responseSecret = "PRIVATE_RESPONSE_BODY_CANARY";
        const statusTextSecret = "PRIVATE_STATUS_TEXT_CANARY";
        const entries: LogEntry[] = [];
        const originalWarn = console.warn;
        console.warn = () => {};
        __registerLogRecordEmitter((entry) => entries.push(entry));
        setFetch(() =>
          Promise.resolve(
            new Response(responseSecret, { status: 404, statusText: statusTextSecret }),
          )
        );

        try {
          const error = await captureVeryfrontError(() =>
            requestWithRetry(
              "https://user:password@api.test.com/endpoint?opaque=PRIVATE_QUERY&token=PRIVATE_TOKEN",
              "PRIVATE_API_TOKEN",
              { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            )
          );

          const emitted = JSON.stringify({
            detail: error.detail,
            context: error.context,
            entries,
          });
          for (
            const secret of [
              responseSecret,
              statusTextSecret,
              "password",
              "PRIVATE_QUERY",
              "PRIVATE_TOKEN",
              "PRIVATE_API_TOKEN",
            ]
          ) {
            assertEquals(emitted.includes(secret), false);
          }
        } finally {
          console.warn = originalWarn;
        }
      });

      it("emits stable request metadata without concrete API hosts or paths", async () => {
        const hostCanary = "private-api-host-canary.example";
        const pathCanary = "PRIVATE_API_PATH_CANARY";
        const projectCanary = "PRIVATE_PROJECT_CANARY";
        const releaseCanary = "PRIVATE_RELEASE_CANARY";
        const fileCanary = "PRIVATE_FILE_CANARY";
        const entries: LogEntry[] = [];
        const spanAttributes: Array<Record<string, AttributeValue>> = [];
        const spanContext: SpanContext = {
          traceId: "00000000000000000000000000000000",
          spanId: "0000000000000000",
          traceFlags: 0,
        };
        const span: Span = {
          setAttribute() {
            return span;
          },
          setAttributes() {
            return span;
          },
          setStatus() {
            return span;
          },
          recordException() {},
          addEvent() {
            return span;
          },
          end() {},
          spanContext: () => spanContext,
          updateName() {},
        };
        setGlobalTracerProvider({
          getTracer: () => ({
            startSpan(_name, options) {
              spanAttributes.push(options?.attributes ?? {});
              return span;
            },
            startActiveSpan: (_name: string, ...args: unknown[]) => {
              const callback = args.find((arg) => typeof arg === "function") as
                | ((span: Span) => unknown)
                | undefined;
              return callback?.(span);
            },
          }),
        });
        __registerLogRecordEmitter((entry) => entries.push(entry));
        setFetch(() => Promise.resolve(new Response(null, { status: 404 })));

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            `https://${hostCanary}/${pathCanary}/projects/${projectCanary}/releases/${releaseCanary}/files/${fileCanary}`,
            "test-token",
            { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
            {
              telemetry: {
                operation: "getReleaseFile",
                route: "/projects/{project}/releases/{release}/files/{file}",
              },
            },
          )
        );

        const emitted = JSON.stringify({
          entries,
          spanAttributes,
          error: { detail: error.detail, context: error.context },
        });
        for (
          const canary of [
            hostCanary,
            pathCanary,
            projectCanary,
            releaseCanary,
            fileCanary,
          ]
        ) {
          assertEquals(emitted.includes(canary), false);
        }
        assertEquals(emitted.includes("getReleaseFile"), true);
        assertEquals(
          emitted.includes("/projects/{project}/releases/{release}/files/{file}"),
          true,
        );
      });

      it("cancels an error response body instead of buffering it", async () => {
        let cancelled = false;
        let buffered = false;
        setFetch(() =>
          Promise.resolve(
            {
              ok: false,
              status: 404,
              statusText: "Not Found",
              headers: new Headers(),
              body: {
                cancel() {
                  cancelled = true;
                  return Promise.resolve();
                },
              },
              text() {
                buffered = true;
                return Promise.resolve("provider error body");
              },
            } as unknown as Response,
          )
        );

        await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(cancelled, true);
        assertEquals(buffered, false);
      });
    });

    describe("429 rate limiting - should retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry 429 errors with backoff", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Too Many Requests", {
                status: 429,
                statusText: "Too Many Requests",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 3, "Should retry 429 errors");
        assertEquals(result, { ok: true });
      });

      it("uses a valid Retry-After delay instead of local exponential backoff", async () => {
        const entries: LogEntry[] = [];
        const originalWarn = console.warn;
        console.warn = () => {};
        __registerLogRecordEmitter((entry) => entries.push(entry));
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            return Promise.resolve(
              new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": "0" },
              }),
            );
          }
          return Promise.resolve(Response.json({ ok: true }));
        });

        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 1, initialDelay: 100, maxDelay: 1_000 },
          );
        } finally {
          console.warn = originalWarn;
        }

        const retryEntry = entries.find((entry) => entry.message === "Request failed, retrying");
        assertExists(retryEntry);
        assertEquals(retryEntry.context?.delay, 0);
        assertEquals(retryEntry.context?.delaySource, "retry-after");
      });

      it("does not shorten an HTTP-date Retry-After value to the local maxDelay", async () => {
        const entries: LogEntry[] = [];
        const originalWarn = console.warn;
        console.warn = () => {};
        __registerLogRecordEmitter((entry) => entries.push(entry));
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            return Promise.resolve(
              new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": new Date(Date.now() + 60_000).toUTCString() },
              }),
            );
          }
          return Promise.resolve(Response.json({ ok: true }));
        });

        try {
          const error = await captureVeryfrontError(() =>
            requestWithRetry(
              "https://api.test.com/endpoint",
              "test-token",
              { maxRetries: 1, initialDelay: 1, maxDelay: 2 },
              { totalTimeoutMs: 20 },
            )
          );
          assertEquals(error.status, 429);
        } finally {
          console.warn = originalWarn;
        }

        const retryEntry = entries.find((entry) => entry.message === "Request failed, retrying");
        assertEquals(retryEntry, undefined);
        assertEquals(fetchCallCount, 1);
      });
    });

    describe("request lifecycle", () => {
      it("does not start a request when the caller signal is already aborted", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });
        const controller = new AbortController();
        controller.abort();

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 3, initialDelay: 1, maxDelay: 1 },
            { signal: controller.signal },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.slug, "api-client-error");
        assertEquals(error.status, 499);
      });

      it("classifies exhausted request timeouts as gateway timeouts", async () => {
        setFetch((_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("request aborted", "AbortError")),
              { once: true },
            );
          })
        );

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { timeoutMs: 1 },
          )
        );

        assertEquals(error.status, 504);
      });

      it("bounds the entire retry lifecycle with a total timeout", async () => {
        let fetchCallCount = 0;
        setFetch((_url, init) => {
          fetchCallCount++;
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("request aborted", "AbortError")),
              { once: true },
            );
          });
        });

        const startedAt = performance.now();
        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 20, initialDelay: 1, maxDelay: 1 },
            { timeoutMs: 1_000, totalTimeoutMs: 10 },
          )
        );

        assertEquals(error.status, 504);
        assertEquals(fetchCallCount, 1);
        assertEquals(performance.now() - startedAt < 250, true);
      });

      it("bounds a fetch implementation that ignores the abort signal", async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        setFetch(() =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
        );

        const request = captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { timeoutMs: 10, totalTimeoutMs: 20 },
          )
        );
        const outcome = await Promise.race([
          request.then((error) => ({ kind: "error" as const, error })),
          delay(100).then(() => ({ kind: "hung" as const })),
        ]);

        if (outcome.kind === "hung") {
          resolveFetch?.(Response.json({ ok: true }));
          await request;
        }

        assertEquals(outcome.kind, "error");
        if (outcome.kind === "error") assertEquals(outcome.error.status, 504);
      });

      it("cancels a response body reader that ignores the fetch signal at the total timeout", async () => {
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        let cancelled = false;
        setFetch(() =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  streamController = controller;
                  controller.enqueue(new TextEncoder().encode("partial"));
                },
                cancel() {
                  cancelled = true;
                },
              }),
            ),
          )
        );

        const request = captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { returnText: true, timeoutMs: 1_000, totalTimeoutMs: 10 },
          )
        );
        const outcome = await Promise.race([
          request.then((error) => ({ kind: "error" as const, error })),
          delay(100).then(() => ({ kind: "hung" as const })),
        ]);

        if (outcome.kind === "hung") {
          streamController?.close();
          await request;
        }

        assertEquals(outcome.kind, "error");
        if (outcome.kind === "error") assertEquals(outcome.error.status, 504);
        assertEquals(cancelled, true);
      });

      it("rejects an oversized successful response and cancels the unread body", async () => {
        let cancelled = false;
        setFetch(() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("12345"));
                },
                cancel() {
                  cancelled = true;
                },
              }),
              { status: 200 },
            ),
          )
        );

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { returnText: true, maxResponseBytes: 4 },
          )
        );

        assertEquals(error.status, 502);
        assertEquals(cancelled, true);
      });

      it("accepts a successful response exactly at the byte limit", async () => {
        setFetch(() => Promise.resolve(new Response("exact", { status: 200 })));

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          { returnText: true, maxResponseBytes: 5 },
        );

        assertEquals(result, "exact");
      });

      it("rejects invalid lifecycle and response limits before fetch", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const totalTimeoutError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { totalTimeoutMs: 0 },
          )
        );
        const responseLimitError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { maxResponseBytes: -1 },
          )
        );
        const nullTimeoutError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { timeoutMs: null as never },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(totalTimeoutError.status, 400);
        assertEquals(responseLimitError.status, 400);
        assertEquals(nullTimeoutError.status, 400);
      });

      it("rejects invalid retry configuration before calling fetch", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: -1, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.status, 400);
      });

      it("sanitizes malformed and unreadable request inputs before fetch", async () => {
        const privateFailure = "PRIVATE_REQUEST_INPUT_FAILURE";
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });
        const hostileRetry = Object.create(null);
        Object.defineProperty(hostileRetry, "maxRetries", {
          get() {
            throw new Error(privateFailure);
          },
        });
        const hostileOptions = Object.create(null);
        Object.defineProperty(hostileOptions, "timeoutMs", {
          get() {
            throw new Error(privateFailure);
          },
        });
        const hostileBody = new Proxy({}, {
          getPrototypeOf() {
            throw new Error(privateFailure);
          },
        });

        const tokenError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            null as never,
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );
        const retryError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            hostileRetry,
          )
        );
        const optionsError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            hostileOptions,
          )
        );
        const bodyError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { body: hostileBody as BodyInit },
          )
        );

        assertEquals(fetchCallCount, 0);
        for (const error of [tokenError, retryError, optionsError, bodyError]) {
          assertInstanceOf(error, VeryfrontError);
          assertEquals(error.status === 400 || error.status === 401, true);
          assertEquals(JSON.stringify(error).includes(privateFailure), false);
        }
      });

      it("rejects proxied abort signals without exposing trap failures", async () => {
        const privateFailure = "PRIVATE_ABORT_SIGNAL_TRAP";
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });
        const signal = new Proxy(new AbortController().signal, {
          get(target, property, receiver) {
            if (property === "aborted" || property === "addEventListener") {
              throw new Error(privateFailure);
            }
            return Reflect.get(target, property, receiver);
          },
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { signal },
          )
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.status, 400);
        assertEquals(fetchCallCount, 0);
        assertEquals(JSON.stringify(error).includes(privateFailure), false);
      });

      it("rejects an excessive retry budget before calling fetch", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 21, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.status, 400);
      });

      it("rejects an empty API token before calling fetch", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "   ",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.status, 401);
      });

      it("rejects an API token containing header control characters", async () => {
        const secret = "PRIVATE_INVALID_TOKEN_CANARY";
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            `token\n${secret}`,
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.status, 401);
        assertEquals(JSON.stringify(error).includes(secret), false);
      });

      it("rejects malformed methods and headers before calling fetch", async () => {
        const secret = "PRIVATE_INVALID_HEADER_CANARY";
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const methodError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { method: "GET\nINJECTED" },
          )
        );
        const headerError = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
            { headers: { "X-Test": `value\n${secret}` } },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(methodError.status, 400);
        assertEquals(headerError.status, 400);
        assertEquals(JSON.stringify(headerError).includes(secret), false);
      });

      it("wraps malformed URLs without exposing their contents", async () => {
        const secret = "PRIVATE_INVALID_URL_CANARY";

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            `not a url?token=${secret}`,
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.status, 400);
        assertEquals(JSON.stringify(error).includes(secret), false);
      });

      it("rejects URL credentials before calling fetch", async () => {
        const secret = "PRIVATE_URL_CREDENTIAL_CANARY";
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            `https://user:${secret}@api.test.com/endpoint`,
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(fetchCallCount, 0);
        assertEquals(error.status, 400);
        assertEquals(JSON.stringify(error).includes(secret), false);
      });

      it("returns undefined for a successful response with no body", async () => {
        setFetch(() => Promise.resolve(new Response(null, { status: 204 })));

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
        );

        assertEquals(result, undefined);
      });

      it("classifies invalid JSON responses as upstream failures", async () => {
        setFetch(() => Promise.resolve(new Response("not-json", { status: 200 })));

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(error.status, 502);
      });

      it("retries request-timeout responses", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 408 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        );

        assertEquals(fetchCallCount, 2);
        assertEquals(result, { ok: true });
      });

      it("does not retry a request body that cannot be replayed", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 500 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
            { method: "POST", body: new ReadableStream() },
          )
        );

        assertEquals(fetchCallCount, 1);
        assertEquals(error.status, 500);
        assertEquals((error.context as { details?: { attempts?: number } }).details?.attempts, 1);
      });

      it("does not retry a non-idempotent request without explicit permission", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 500 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
            { method: "POST", body: "{}" },
          )
        );

        assertEquals(fetchCallCount, 1);
        assertEquals(error.status, 500);
      });

      it("retries a non-idempotent request with explicit permission", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 500 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          { method: "POST", body: "{}", retryable: true },
        );

        assertEquals(fetchCallCount, 2);
        assertEquals(result, { ok: true });
      });

      it("retries a request carrying an idempotency key", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 500 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          { method: "POST", body: "{}", headers: { "Idempotency-Key": "request-1" } },
        );

        assertEquals(fetchCallCount, 2);
        assertEquals(result, { ok: true });
      });

      it("does not retry a request carrying an empty idempotency key", async () => {
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 500 }));
          return Promise.resolve(Response.json({ ok: true }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
            { method: "POST", body: "{}", headers: { "Idempotency-Key": "" } },
          )
        );

        assertEquals(fetchCallCount, 1);
        assertEquals(error.status, 500);
      });

      it("snapshots request headers and body for every retry attempt", async () => {
        const requestHeaders: string[] = [];
        const requestBodies: string[] = [];
        const headers = { "X-Request": "original" };
        const body = new URLSearchParams({ value: "original" });
        const options = {
          method: "POST",
          retryable: true,
          headers,
          body,
        };
        let fetchCallCount = 0;
        setFetch((_url, init) => {
          fetchCallCount++;
          requestHeaders.push(new Headers(init?.headers).get("X-Request") ?? "");
          requestBodies.push(String(init?.body));
          if (fetchCallCount === 1) {
            headers["X-Request"] = "mutated";
            body.set("value", "mutated");
            options.body = new URLSearchParams({ value: "replacement" });
            return Promise.resolve(new Response(null, { status: 500 }));
          }
          return Promise.resolve(Response.json({ ok: true }));
        });

        await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          options,
        );

        assertEquals(requestHeaders, ["original", "original"]);
        assertEquals(requestBodies, ["value=original", "value=original"]);
      });

      it("snapshots retry configuration before the first attempt", async () => {
        const retryConfig = { maxRetries: 1, initialDelay: 0, maxDelay: 0 };
        let fetchCallCount = 0;
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            retryConfig.maxRetries = 0;
            return Promise.resolve(new Response(null, { status: 500 }));
          }
          return Promise.resolve(Response.json({ ok: true }));
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          retryConfig,
        );

        assertEquals(fetchCallCount, 2);
        assertEquals(result, { ok: true });
      });
    });

    describe("5xx server errors - should retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry 500 errors with backoff", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Internal Server Error", {
                status: 500,
                statusText: "Internal Server Error",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 3, "Should retry 500 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 502 errors", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 502 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 503 errors", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Service Unavailable", {
                status: 503,
                statusText: "Service Unavailable",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 503 errors");
        assertEquals(result, { ok: true });
      });

      it("should fail after max retries exhausted", async () => {
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Internal Server Error", {
              status: 500,
              statusText: "Internal Server Error",
            }),
          );
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 2, initialDelay: 10, maxDelay: 100 },
          )
        );

        assertExists(error, "Should throw an error after retries exhausted");
        assertEquals(fetchCallCount, 3, "Should attempt 1 initial + 2 retries = 3 total");
      });
    });

    describe("network errors - should retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry network failures", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) return Promise.reject(new Error("Network error"));
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry network errors");
        assertEquals(result, { ok: true });
      });

      it("does not copy arbitrary network error text into the public API error", async () => {
        setFetch(() => Promise.reject(new Error("network failure PRIVATE_NETWORK_CANARY")));

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
          )
        );

        assertEquals(
          JSON.stringify({
            detail: error.detail,
            context: error.context,
            cause: error.cause,
          }).includes("PRIVATE_NETWORK_CANARY"),
          false,
        );
        assertEquals(error.detail, "API request failed after 1 attempt");
      });

      it("does not record raw network errors in logs or tracing spans", async () => {
        const messageSecret = "PRIVATE_NETWORK_MESSAGE_CANARY";
        const nameSecret = "PRIVATE_NETWORK_NAME_CANARY";
        const entries: LogEntry[] = [];
        const recordedExceptions: unknown[] = [];
        const spanContext: SpanContext = {
          traceId: "00000000000000000000000000000000",
          spanId: "0000000000000000",
          traceFlags: 0,
        };
        const span: Span = {
          setAttribute() {
            return span;
          },
          setAttributes() {
            return span;
          },
          setStatus() {
            return span;
          },
          recordException(error) {
            recordedExceptions.push(error);
          },
          addEvent() {
            return span;
          },
          end() {},
          spanContext: () => spanContext,
          updateName() {},
        };
        setGlobalTracerProvider({
          getTracer: () => ({
            startSpan: () => span,
            startActiveSpan: (_name: string, ...args: unknown[]) => {
              const callback = args.find((arg) => typeof arg === "function") as
                | ((span: Span) => unknown)
                | undefined;
              return callback?.(span);
            },
          }),
        });
        __registerLogRecordEmitter((entry) => entries.push(entry));
        const networkError = new Error(messageSecret);
        networkError.name = nameSecret;
        setFetch(() => Promise.reject(networkError));

        await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          )
        );

        const emitted = JSON.stringify(
          { entries, recordedExceptions },
          (_key, value) =>
            value instanceof Error ? { name: value.name, message: value.message } : value,
        );
        assertEquals(emitted.includes(messageSecret), false);
        assertEquals(emitted.includes(nameSecret), false);
      });
    });

    describe("successful requests", () => {
      it("should return JSON response on success", async () => {
        setFetch(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: "test" }), { status: 200 }),
          )
        );

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
        );

        assertEquals(result, { data: "test" });
      });

      it("should return text response when returnText option is true", async () => {
        setFetch(() => Promise.resolve(new Response("plain text response", { status: 200 })));

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          { returnText: true },
        );

        assertEquals(result, "plain text response");
      });
    });
  });
});
