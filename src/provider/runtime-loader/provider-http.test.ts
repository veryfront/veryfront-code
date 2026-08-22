import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProviderError } from "../../chat/provider-errors.ts";
import { MAX_TIMER_DELAY_MS } from "../../utils/timer.ts";
import {
  buildProviderError,
  parseRetryAfterMs,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  requestJson,
  requestStream,
} from "./provider-http.ts";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers,
  });
}

async function waitWithin<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = 500,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("provider-http", () => {
  describe("parseRetryAfterMs", () => {
    it("parses delta-seconds", () => {
      assertEquals(parseRetryAfterMs("2"), 2000);
      assertEquals(parseRetryAfterMs("0"), 0);
    });

    it("returns undefined for a missing or non-numeric, non-date header", () => {
      assertEquals(parseRetryAfterMs(null), undefined);
      assertEquals(parseRetryAfterMs("not-a-date"), undefined);
    });

    it("rejects malformed numeric delay forms instead of reinterpreting them as dates", () => {
      for (const value of ["1.5", "1e3", "0x10", "-1", "+1"]) {
        assertEquals(parseRetryAfterMs(value), undefined, value);
      }
    });

    it("rejects delta-seconds and dates outside the portable timer range", () => {
      const overflowSeconds = Math.floor(MAX_TIMER_DELAY_MS / 1000) + 1;
      const overflowDate = new Date(Date.now() + MAX_TIMER_DELAY_MS + 60_000).toUTCString();

      assertEquals(parseRetryAfterMs(String(overflowSeconds)), undefined);
      assertEquals(parseRetryAfterMs("9".repeat(400)), undefined);
      assertEquals(parseRetryAfterMs(overflowDate), undefined);
    });

    it("parses an HTTP-date into a non-negative delay", () => {
      const future = new Date(Date.now() + 5000).toUTCString();
      const ms = parseRetryAfterMs(future);
      assertEquals(typeof ms, "number");
      assertEquals(ms !== undefined && ms >= 0, true);
    });
  });

  describe("buildProviderError classification", () => {
    it("anthropic 529 -> retryable overloaded", async () => {
      const err = await buildProviderError("anthropic", jsonResponse(529, { error: "overloaded" }));
      assertEquals(err instanceof ProviderOverloadedError, true);
      assertEquals(err.retryable, true);
      assertEquals(err.status, 529);
    });

    it("anthropic 429 -> retryable rate limit, honoring Retry-After", async () => {
      const err = await buildProviderError(
        "anthropic",
        jsonResponse(429, { error: "rate_limited" }, { "retry-after": "3" }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
      assertEquals(err.retryAfterMs, 3000);
    });

    it("openai 503 -> retryable overloaded", async () => {
      const err = await buildProviderError("openai", jsonResponse(503, "overloaded"));
      assertEquals(err instanceof ProviderOverloadedError, true);
      assertEquals(err.retryable, true);
    });

    it("openai 429 insufficient_quota -> non-retryable quota", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(429, { error: { code: "insufficient_quota", message: "no credit" } }),
      );
      assertEquals(err instanceof ProviderQuotaError, true);
      assertEquals(err.retryable, false);
    });

    it("openai 429 truncated before it could be parsed -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(429, {
          error: { code: "insufficient_quota", message: "x".repeat(9_000) },
        }),
      );

      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "a truncated body cannot prove insufficient_quota, so it stays a rate limit",
      );
      assertEquals(err.retryable, true, "a truncated 429 must reach the bounded retry");
    });

    it("openai 429 with an empty body -> retryable rate limit", async () => {
      const err = await buildProviderError("openai", jsonResponse(429, ""));
      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "an empty body names no quota error",
      );
      assertEquals(err.retryable, true, "an empty 429 must reach the bounded retry");
    });

    it("openai 429 with a non-JSON body -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(429, "<html><body>Too Many Requests</body></html>"),
      );
      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "an HTML gateway page names no quota error",
      );
      assertEquals(err.retryable, true, "a non-JSON 429 must reach the bounded retry");
    });

    it("openai 429 rate_limit_exceeded -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(429, { error: { code: "rate_limit_exceeded", message: "slow down" } }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
    });

    it("mistral 429 insufficient_quota -> non-retryable quota", async () => {
      const err = await buildProviderError(
        "mistral",
        jsonResponse(429, { error: { code: "insufficient_quota" } }),
      );
      assertEquals(err instanceof ProviderQuotaError, true);
      assertEquals(err.retryable, false);
    });

    it("google 429 RESOURCE_EXHAUSTED without a retry delay -> non-retryable quota", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED" } }),
      );
      assertEquals(err instanceof ProviderQuotaError, true);
      assertEquals(err.retryable, false);
    });

    it("google 429 RESOURCE_EXHAUSTED with Retry-After -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(
          429,
          { error: { status: "RESOURCE_EXHAUSTED" } },
          { "retry-after": "7" },
        ),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
      assertEquals(err.retryAfterMs, 7_000);
    });

    it("google 429 RESOURCE_EXHAUSTED with RetryInfo details -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, {
          error: {
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [{ quotaMetric: "generate_requests_per_model_per_minute" }],
              },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" },
            ],
          },
        }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
      assertEquals(err.retryAfterMs, 23_000);
    });

    it("google 429 RESOURCE_EXHAUSTED with QuotaFailure but no RetryInfo -> quota", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, {
          error: {
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [{ quotaMetric: "generate_requests_per_model_per_day" }],
              },
            ],
          },
        }),
      );
      assertEquals(err instanceof ProviderQuotaError, true);
      assertEquals(err.retryable, false);
    });

    it("google 429 truncated before it could be parsed -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, {
          error: { status: "RESOURCE_EXHAUSTED", message: "x".repeat(9_000) },
        }),
      );

      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "a truncated body cannot prove RESOURCE_EXHAUSTED, so it stays a rate limit",
      );
      assertEquals(err.retryable, true, "a truncated 429 must reach the bounded retry");
    });

    it("google 429 with an empty body -> retryable rate limit", async () => {
      const err = await buildProviderError("google", jsonResponse(429, ""));
      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "an empty body names no quota status",
      );
      assertEquals(err.retryable, true, "an empty 429 must reach the bounded retry");
    });

    it("google 429 with a non-JSON body -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, "<html><body>Too Many Requests</body></html>"),
      );
      assertEquals(
        err instanceof ProviderRateLimitError,
        true,
        "an HTML gateway page names no quota status",
      );
      assertEquals(err.retryable, true, "a non-JSON 429 must reach the bounded retry");
    });

    it("google 429 without RESOURCE_EXHAUSTED -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, { error: { status: "ABORTED" } }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
    });

    it("retries unparseable ambiguous 429 bodies", async () => {
      for (const provider of ["openai", "google"] as const) {
        const err = await buildProviderError(provider, jsonResponse(429, "{"));
        assertEquals(err instanceof ProviderRateLimitError, true, provider);
        assertEquals(err.retryable, true, provider);
      }
    });

    it("generic and reverse-proxy transient 5xx -> retryable overloaded", async () => {
      for (
        const status of [500, 502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530, 598, 599]
      ) {
        const err = await buildProviderError("openai", jsonResponse(status, "gateway error"));
        assertEquals(err instanceof ProviderOverloadedError, true, `status ${status}`);
        assertEquals(err.retryable, true, `status ${status}`);
      }
    });

    it("permanent 5xx responses are non-retryable request errors", async () => {
      for (const status of [501, 505, 507]) {
        const err = await buildProviderError("openai", jsonResponse(status, "not supported"));
        assertEquals(err instanceof ProviderRequestError, true, `status ${status}`);
        assertEquals(err.retryable, false, `status ${status}`);
      }
    });

    it("non-retryable 4xx -> ProviderRequestError", async () => {
      for (const status of [400, 401, 403, 404]) {
        const err = await buildProviderError("openai", jsonResponse(status, "bad request"));
        assertEquals(err instanceof ProviderRequestError, true, `status ${status}`);
        assertEquals(err.retryable, false, `status ${status}`);
      }
    });

    it("does not surface provider error body contents", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(500, "private provider payload <TOKEN>"),
      );
      assertEquals(err.message, "Provider request failed with status 500");
      assertEquals(err.message.includes("<TOKEN>"), false);
    });

    it("preserves structured 400 details for internal classification without enumerating them", async () => {
      const responseBody = JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "This model does not support assistant message prefill.",
        },
      });
      const err = await buildProviderError(
        "anthropic",
        jsonResponse(400, responseBody),
      );

      assertEquals(err.responseBody, responseBody);
      assertEquals(Object.keys(err).includes("responseBody"), false);
      assertEquals(JSON.stringify(err).includes("assistant message prefill"), false);
      assertEquals(err.message, "Provider request failed with status 400");
      assertEquals(parseProviderError(err), {
        code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
        message:
          "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
      });
    });

    it("preserves invalid-request details when a provider also supplies a specific code", async () => {
      const responseBody = JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "context_length_exceeded",
          message: "The prompt is too long for this model.",
        },
      });
      const err = await buildProviderError(
        "openai",
        jsonResponse(400, responseBody),
      );

      assertEquals(err.responseBody, responseBody);
      assertEquals(parseProviderError(err), {
        code: "CONTEXT_LENGTH_EXCEEDED",
        message: "Conversation is too long",
      });
    });

    it("preserves structured Veryfront 402 problems for internal classification", async () => {
      const responseBody = JSON.stringify({
        slug: "insufficient-credits",
        error: "AI credit limit exceeded",
        balance: 0,
        required: 4,
      });
      const err = await buildProviderError(
        "openai",
        jsonResponse(402, responseBody),
      );

      assertEquals(err.responseBody, responseBody);
      assertEquals(Object.keys(err).includes("responseBody"), false);
      assertEquals(JSON.stringify(err).includes("AI credit limit exceeded"), false);
      assertEquals(err.message, "Provider request failed with status 402");
      assertEquals(parseProviderError(err), {
        code: "INSUFFICIENT_CREDITS",
        message: "AI credit limit exceeded: 4 credits required, 0 available.",
        status: 402,
      });
    });

    it("preserves structured Veryfront resource limit problems for classification", async () => {
      const responseBody = JSON.stringify({
        slug: "resource-limit-exceeded",
        error: "Resource limit exceeded",
        suggestion: "Reduce the request size and try again.",
      });
      const err = await buildProviderError(
        "openai",
        jsonResponse(402, responseBody),
      );

      assertEquals(err.responseBody, responseBody);
      assertEquals(Object.keys(err).includes("responseBody"), false);
      assertEquals(parseProviderError(err), {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Reduce the request size and try again.",
        status: 402,
      });
    });

    it("preserves a Google 400 that names itself INVALID_ARGUMENT", async () => {
      // Google's envelope carries no `type`, so keying preservation on
      // `invalid_request_error` alone dropped the body for every Google 400 --
      // leaving the classifier downstream nothing to work with.
      const responseBody = JSON.stringify({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "This model does not support assistant message prefill.",
        },
      });
      const err = await buildProviderError("google", jsonResponse(400, responseBody));

      assertEquals(err.responseBody, responseBody);
      assertEquals(Object.keys(err).includes("responseBody"), false);
      assertEquals(err.message, "Provider request failed with status 400");
      assertEquals(JSON.stringify(err).includes("assistant message prefill"), false);
    });

    it("does not preserve a 400 whose envelope names no rejection reason", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(400, {
          error: { code: 400, status: "UNKNOWN", message: "private provider payload <TOKEN>" },
        }),
      );

      assertEquals(err.responseBody, undefined);
      assertEquals(JSON.stringify(err).includes("<TOKEN>"), false);
    });

    it("does not preserve arbitrary provider 402 response details", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(402, {
          error: {
            message: "private provider payload <TOKEN>",
          },
        }),
      );

      assertEquals(err.responseBody, undefined);
      assertEquals(JSON.stringify(err).includes("<TOKEN>"), false);
      assertEquals(parseProviderError(err), {
        code: "EXTERNAL_SERVICE_ERROR",
        message: "LLM provider service error",
      });
    });

    it("does not preserve arbitrary provider api error messages", async () => {
      const err = await buildProviderError(
        "anthropic",
        jsonResponse(400, {
          type: "error",
          error: {
            type: "api_error",
            message: "private provider payload <TOKEN>",
          },
        }),
      );

      assertEquals(err.responseBody, undefined);
      assertEquals(parseProviderError(err), {
        code: "EXTERNAL_SERVICE_ERROR",
        message: "LLM provider service error",
      });
      assertEquals(JSON.stringify(err).includes("<TOKEN>"), false);
    });

    it("uses the response status when the body is empty", async () => {
      const err = await buildProviderError("openai", new Response("", { status: 500 }));
      assertEquals(err.message, "Provider request failed with status 500");
    });
  });

  describe("requestJson", () => {
    it("returns a valid JSON response at the configured byte boundary", async () => {
      const body = JSON.stringify({ ok: true });
      const result = await requestJson({
        url: "https://provider.test/generate",
        fetchImpl: () => Promise.resolve(new Response(body)),
        init: { method: "POST" },
        providerLabel: "Test provider",
        providerKind: "openai",
        maxResponseBytes: new TextEncoder().encode(body).byteLength,
      });

      assertEquals(result, { ok: true });
    });

    it("rejects malformed JSON without leaking the response payload", async () => {
      const privatePayload = "not-json private payload <TOKEN>";
      const error = await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: () => Promise.resolve(new Response(privatePayload)),
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
          }),
        ProviderRequestError,
        "response body was not valid JSON",
      ) as ProviderRequestError;

      assertEquals(error.status, 200);
      assertEquals(error.retryable, false);
      assertEquals(error.message.includes(privatePayload), false);
      assertEquals(error.message.includes("<TOKEN>"), false);
    });

    it("rejects invalid UTF-8 JSON without accepting replacement characters or leaking data", async () => {
      const prefix = new TextEncoder().encode('{"value":"private <TOKEN> ');
      const suffix = new TextEncoder().encode('"}');
      const body = new Uint8Array(prefix.byteLength + 2 + suffix.byteLength);
      body.set(prefix);
      body.set([0xc3, 0x28], prefix.byteLength);
      body.set(suffix, prefix.byteLength + 2);

      const error = await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: () => Promise.resolve(new Response(body)),
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
          }),
        ProviderRequestError,
        "Test provider request failed: response body was not valid UTF-8",
      ) as ProviderRequestError;

      assertEquals(error.provider, "openai");
      assertEquals(error.status, 200);
      assertEquals(error.retryable, false);
      assertEquals(error.message.includes("<TOKEN>"), false);
      assertEquals(JSON.stringify(error).includes("<TOKEN>"), false);
    });

    it("rejects a response above the configured byte limit", async () => {
      const error = await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: () => Promise.resolve(new Response("[123]")),
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
            maxResponseBytes: 4,
          }),
        ProviderRequestError,
        "JSON response exceeded 4 bytes",
      ) as ProviderRequestError;

      assertEquals(error.status, 200);
      assertEquals(error.retryable, false);
    });

    for (const chunk of [new Uint8Array(0), Uint8Array.of(0x20)]) {
      it(
        `bounds JSON body read work for ${
          chunk.byteLength === 0 ? "zero-byte" : "one-byte"
        } chunks`,
        async () => {
          let readCalls = 0;
          let cancelCalls = 0;
          const body = new ReadableStream<Uint8Array>();
          const hostileReader = {
            read() {
              readCalls += 1;
              return Promise.resolve({ done: false, value: chunk });
            },
            cancel() {
              cancelCalls += 1;
              return Promise.resolve();
            },
            releaseLock() {},
          } as unknown as ReadableStreamDefaultReader<Uint8Array>;
          Object.defineProperty(body, "getReader", {
            configurable: true,
            value: () => hostileReader,
          });

          await assertRejects(
            () =>
              requestJson({
                url: "https://provider.test/generate",
                fetchImpl: () => Promise.resolve(new Response(body)),
                init: { method: "POST" },
                providerLabel: "Test provider",
                providerKind: "openai",
                maxResponseBytes: 100_000,
              }),
            ProviderRequestError,
            "JSON response exceeded 65536 body reads",
          );

          assertEquals(readCalls, 65_536);
          assertEquals(cancelCalls, 1);
        },
      );
    }

    it("rejects an impractically large response limit before allocating", async () => {
      await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: () => Promise.resolve(new Response("{}")),
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
            maxResponseBytes: 256 * 1024 * 1024 + 1,
          }),
        RangeError,
        "maxResponseBytes must be a positive safe integer no greater than 268435456",
      );
    });

    it("enforces its deadline when a custom fetch ignores AbortSignal", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      const error = await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: neverResponds,
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
            timeoutMs: 5,
          }),
        ProviderRequestError,
        "request timed out",
      ) as ProviderRequestError;

      assertEquals(error.status, 0);
      assertEquals(error.retryable, true);
    });

    it("names the model, the elapsed time, and the deadline that fired", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      const error = await assertRejects(
        () =>
          requestJson({
            url: "https://provider.test/generate",
            fetchImpl: neverResponds,
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            modelId: "moonshotai/kimi-k2.6",
            timeoutMs: 5,
          }),
        ProviderRequestError,
      ) as ProviderRequestError;

      assertMatch(
        error.message,
        /^veryfront-cloud request failed: request timed out after \d+ms waiting for the JSON response \(5ms deadline, model moonshotai\/kimi-k2\.6\)$/,
        "a JSON timeout must name the elapsed time, the deadline, and the model",
      );
    });

    it("preserves caller cancellation when a custom fetch ignores AbortSignal", async () => {
      const controller = new AbortController();
      const reason = new DOMException("caller stopped waiting", "AbortError");
      let receivedSignal: AbortSignal | null | undefined;
      const neverResponds: typeof fetch = (input, init) => {
        receivedSignal = new Request(input, init).signal;
        return new Promise<Response>(() => {});
      };
      const request = requestJson({
        url: "https://provider.test/generate",
        fetchImpl: neverResponds,
        init: { method: "POST", signal: controller.signal },
        providerLabel: "Test provider",
        providerKind: "openai",
        timeoutMs: 1_000,
      });

      controller.abort(reason);
      const error = await request.then(
        () => undefined,
        (caught) => caught,
      );

      assertStrictEquals(error, reason);
      assertEquals(receivedSignal?.aborted, true);
      assertStrictEquals(receivedSignal?.reason, reason);
    });
  });

  describe("requestStream", () => {
    it("returns the successful response body", async () => {
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => Promise.resolve(new Response("chunk")),
        init: { method: "POST" },
        providerLabel: "Test provider",
        providerKind: "openai",
      });

      assertEquals(await new Response(stream).text(), "chunk");
    });

    it("retries a rate-limited stream request before provider output", async () => {
      let attempts = 0;
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(
            attempts === 1
              ? jsonResponse(
                429,
                { error: { code: "rate_limit_exceeded", message: "slow down" } },
                { "retry-after": "0" },
              )
              : new Response("chunk"),
          );
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
      });

      assertEquals(attempts, 2);
      assertEquals(await new Response(stream).text(), "chunk");
    });

    it("bounds rate-limit retries", async () => {
      let attempts = 0;
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return Promise.resolve(jsonResponse(
                429,
                { error: { code: "rate_limit_exceeded", message: "slow down" } },
                { "retry-after": "0" },
              ));
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
          }),
        ProviderRateLimitError,
      ) as ProviderRateLimitError;

      assertEquals(attempts, 3);
      assertEquals(error.retryable, true);
    });

    it("does not retry a rate limit with a non-replayable stream body", async () => {
      let attempts = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request"));
          controller.close();
        },
      });
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return Promise.resolve(jsonResponse(
                429,
                { error: { code: "rate_limit_exceeded", message: "slow down" } },
                { "retry-after": "0" },
              ));
            },
            init: { method: "POST", body },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
          }),
        ProviderRateLimitError,
      ) as ProviderRateLimitError;

      assertEquals(attempts, 1);
      assertEquals(error.retryable, true);
    });

    it("keeps rate-limit backoff inside the stream header deadline", async () => {
      let attempts = 0;
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return Promise.resolve(jsonResponse(
                429,
                { error: { code: "rate_limit_exceeded", message: "slow down" } },
                { "retry-after": "1" },
              ));
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            headersTimeoutMs: 5,
          }),
        ProviderRateLimitError,
      ) as ProviderRateLimitError;

      assertEquals(attempts, 1, "a delay past the deadline must not spend a second attempt");
      assertEquals(error.retryable, true, "the rate limit is still retryable by an outer caller");
      assertEquals(
        error.message.includes("timed out"),
        false,
        "the provider rate limited us; it did not time out",
      );
    });

    it("surfaces an unreadable 429 as a rate limit when its delay outlives the deadline", async () => {
      let attempts = 0;
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return Promise.resolve(jsonResponse(
                429,
                "<html><body>Too Many Requests</body></html>",
                { "retry-after": "60" },
              ));
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            modelId: "moonshotai/kimi-k2.6",
            headersTimeoutMs: 20,
          }),
        ProviderRateLimitError,
      ) as ProviderRateLimitError;

      assertEquals(attempts, 1, "a 60s delay cannot fit a 20ms deadline, so do not retry");
      assertEquals(error.status, 429, "the real provider status must survive");
      assertEquals(
        error.message.includes("timed out"),
        false,
        "an unreadable 429 must not be reported as a stalled gateway",
      );
    });

    it("enforces its header deadline when a custom fetch ignores AbortSignal", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: neverResponds,
            init: { method: "POST" },
            providerLabel: "Test provider",
            providerKind: "openai",
            headersTimeoutMs: 5,
          }),
        ProviderRequestError,
        "request timed out",
      ) as ProviderRequestError;

      assertEquals(error.status, 0);
      assertEquals(error.retryable, true);
    });

    it("names the model, the elapsed time, and the deadline that fired", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: neverResponds,
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            modelId: "moonshotai/kimi-k2.6",
            headersTimeoutMs: 5,
          }),
        ProviderRequestError,
      ) as ProviderRequestError;

      assertMatch(
        error.message,
        /^veryfront-cloud request failed: request timed out after \d+ms waiting for the stream response headers \(5ms deadline, model moonshotai\/kimi-k2\.6\)$/,
        "a stream-header timeout must name the elapsed time, the deadline, and the model",
      );
    });

    it("omits the model from a timeout when the caller did not name one", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: neverResponds,
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            headersTimeoutMs: 5,
          }),
        ProviderRequestError,
      ) as ProviderRequestError;

      assertMatch(
        error.message,
        /request timed out after \d+ms waiting for the stream response headers \(5ms deadline\)$/,
        "an unnamed model must leave the rest of the diagnostic intact",
      );
    });

    it("retries a stream request whose response headers never arrived", async () => {
      let attempts = 0;
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return attempts === 1
            ? new Promise<Response>(() => {})
            : Promise.resolve(new Response("chunk"));
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
        headersTimeoutMs: 5,
      });

      assertEquals(attempts, 2, "a stalled gateway must cost an attempt, not the run");
      assertEquals(await new Response(stream).text(), "chunk");
    });

    it("bounds stream-header timeout retries", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      let attempts = 0;
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: (...args) => {
              attempts++;
              return neverResponds(...args);
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            headersTimeoutMs: 5,
          }),
        ProviderRequestError,
        "request timed out",
      ) as ProviderRequestError;

      assertEquals(attempts, 3, "replays must be bounded and then give up");
      assertEquals(error.status, 0);
      assertEquals(error.retryable, true);
    });

    it("caps total header wait across replays so it stays under the fork idle watchdog", async () => {
      const neverResponds: typeof fetch = () => new Promise<Response>(() => {});
      let attempts = 0;
      const startedAt = Date.now();
      await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: (...args) => {
              attempts++;
              return neverResponds(...args);
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            headersTimeoutMs: 200,
            totalHeadersBudgetMs: 250,
          }),
        ProviderRequestError,
        "request timed out",
      );
      const elapsedMs = Date.now() - startedAt;

      assertEquals(attempts >= 2, true, `a replay must still be issued (attempts=${attempts})`);
      assertEquals(
        elapsedMs < 400,
        true,
        `three unclamped 200ms attempts run ~600ms; the budget must cut it short (elapsed=${elapsedMs}ms)`,
      );
    });

    it("never shortens the first attempt to reserve budget for a replay", async () => {
      let attempts = 0;
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("chunk")), 120);
          });
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
        headersTimeoutMs: 200,
        // Deliberately below the per-attempt deadline: a first attempt clamped
        // to the total budget would abort at 50ms and lose a response that
        // arrives comfortably inside its own deadline.
        totalHeadersBudgetMs: 50,
      });

      assertEquals(attempts, 1);
      assertEquals(await new Response(stream).text(), "chunk");
    });

    it("does not replay a stream-header timeout with a non-replayable request body", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request"));
          controller.close();
        },
      });
      let attempts = 0;
      await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return new Promise<Response>(() => {});
            },
            init: { method: "POST", body },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
            headersTimeoutMs: 5,
          }),
        ProviderRequestError,
        "request timed out",
      );

      assertEquals(attempts, 1, "fetch can consume a stream body, so it cannot be replayed");
    });

    it("never replays a stream once provider output has been exposed", async () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const headersTimeoutMs = 5;
      let attempts = 0;
      let bodyController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      });

      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(new Response(body));
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
        headersTimeoutMs,
      });
      const reader = stream.getReader();
      bodyController.enqueue(encoder.encode("first"));
      assertEquals(
        decoder.decode((await waitWithin(reader.read(), "the first chunk")).value),
        "first",
      );

      // Idle well past the header deadline with output already delivered. The
      // deadline timer is cancelled before the body is handed back, so this
      // window must not produce a timeout — and therefore cannot produce a
      // replay of output the caller has already seen.
      await sleep(headersTimeoutMs * 10);

      bodyController.enqueue(encoder.encode("second"));
      bodyController.close();
      assertEquals(
        decoder.decode((await waitWithin(reader.read(), "the second chunk")).value),
        "second",
      );
      assertEquals((await waitWithin(reader.read(), "the stream to close")).done, true);
      assertEquals(attempts, 1, "exposed output must never be replayed");
    });

    it("does not replay a stream that fails after provider output", async () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const failure = new Error("upstream body failed");
      let attempts = 0;
      let bodyController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      });

      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(new Response(body));
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
        headersTimeoutMs: 5,
      });
      const reader = stream.getReader();
      bodyController.enqueue(encoder.encode("first"));
      assertEquals(
        decoder.decode((await waitWithin(reader.read(), "the first chunk")).value),
        "first",
      );

      bodyController.error(failure);

      const caught = await waitWithin(
        reader.read().then(() => undefined, (error) => error),
        "the mid-stream failure to propagate",
      );
      assertStrictEquals(caught, failure, "the caller must see the real failure");
      assertEquals(attempts, 1, "a failure after output must end the request, not replay it");
    });

    it("does not replay a non-retryable provider failure", async () => {
      let attempts = 0;
      const error = await assertRejects(
        () =>
          requestStream({
            url: "https://provider.test/stream",
            fetchImpl: () => {
              attempts++;
              return Promise.resolve(jsonResponse(
                429,
                { error: { code: "insufficient_quota", message: "quota exhausted" } },
              ));
            },
            init: { method: "POST" },
            providerLabel: "veryfront-cloud",
            providerKind: "moonshotai",
          }),
        ProviderQuotaError,
      ) as ProviderQuotaError;

      assertEquals(attempts, 1, "a hard quota must not be replayed against the provider");
      assertEquals(error.retryable, false);
    });

    it("does not replay a failure raised after the response body was claimed", async () => {
      const claimFailure = new TypeError("response body is already locked");
      const body = new ReadableStream<Uint8Array>();
      Object.defineProperty(body, "getReader", {
        configurable: true,
        value: () => {
          throw claimFailure;
        },
      });
      let attempts = 0;

      const caught = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(new Response(body));
        },
        init: { method: "POST" },
        providerLabel: "veryfront-cloud",
        providerKind: "moonshotai",
        headersTimeoutMs: 5,
      }).then(() => undefined, (error) => error);

      assertStrictEquals(caught, claimFailure, "the real failure must reach the caller");
      assertEquals(attempts, 1, "the body was claimed; the request must not be replayed");
    });

    it("preserves caller cancellation while response headers are pending", async () => {
      const controller = new AbortController();
      const reason = new DOMException("caller stopped waiting", "AbortError");
      let receivedSignal: AbortSignal | null | undefined;
      const neverResponds: typeof fetch = (input, init) => {
        receivedSignal = new Request(input, init).signal;
        return new Promise<Response>(() => {});
      };
      const request = requestStream({
        url: "https://provider.test/stream",
        fetchImpl: neverResponds,
        init: { method: "POST", signal: controller.signal },
        providerLabel: "Test provider",
        providerKind: "openai",
        headersTimeoutMs: 1_000,
      });

      controller.abort(reason);
      const error = await request.then(
        () => undefined,
        (caught) => caught,
      );

      assertStrictEquals(error, reason);
      assertEquals(receivedSignal?.aborted, true);
      assertStrictEquals(receivedSignal?.reason, reason);
    });

    it("keeps caller cancellation connected after response headers arrive", async () => {
      const controller = new AbortController();
      const reason = new DOMException("caller stopped streaming", "AbortError");
      let receivedSignal: AbortSignal | null | undefined;
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: (input, init) => {
          receivedSignal = new Request(input, init).signal;
          return Promise.resolve(new Response("chunk"));
        },
        init: { method: "POST", signal: controller.signal },
        providerLabel: "Test provider",
        providerKind: "openai",
      });

      controller.abort(reason);

      assertEquals(receivedSignal?.aborted, true);
      assertStrictEquals(receivedSignal?.reason, reason);
      const streamError = await stream.cancel().then(
        () => undefined,
        (caught) => caught,
      );
      assertStrictEquals(streamError, reason);
    });

    it("does not wait for non-settling upstream cancellation during a pending pull", async () => {
      const pullStarted = Promise.withResolvers<void>();
      const neverSettles = new Promise<void>(() => {});
      let upstreamCancelReason: unknown;
      let requestSignal: AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          pullStarted.resolve();
          return neverSettles;
        },
        cancel(reason) {
          upstreamCancelReason = reason;
          return neverSettles;
        },
      });
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: (input, init) => {
          requestSignal = new Request(input, init).signal;
          return Promise.resolve(new Response(body));
        },
        init: { method: "POST" },
        providerLabel: "Test provider",
        providerKind: "openai",
      });
      const reader = stream.getReader();
      const pendingRead = reader.read();
      await waitWithin(pullStarted.promise, "the upstream pull to start");
      const reason = new DOMException("consumer stopped streaming", "AbortError");

      await waitWithin(reader.cancel(reason), "consumer cancellation");

      assertStrictEquals(upstreamCancelReason, reason);
      assertEquals(requestSignal?.aborted, true);
      assertStrictEquals(requestSignal?.reason, reason);
      assertEquals(
        await waitWithin(pendingRead, "the canceled pending read to close"),
        { done: true, value: undefined },
      );
    });

    it("aborts a pending body read without waiting for non-settling cleanup", async () => {
      const controller = new AbortController();
      const reason = new DOMException("caller stopped streaming", "AbortError");
      const pullStarted = Promise.withResolvers<void>();
      const neverSettles = new Promise<void>(() => {});
      let upstreamCancelReason: unknown;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          pullStarted.resolve();
          return neverSettles;
        },
        cancel(cancelReason) {
          upstreamCancelReason = cancelReason;
          return neverSettles;
        },
      });
      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => Promise.resolve(new Response(body)),
        init: { method: "POST", signal: controller.signal },
        providerLabel: "Test provider",
        providerKind: "openai",
      });
      const reader = stream.getReader();
      const pendingRead = reader.read();
      await waitWithin(pullStarted.promise, "the upstream pull to start");

      controller.abort(reason);

      const error = await waitWithin(
        pendingRead.then(
          () => undefined,
          (caught) => caught,
        ),
        "the aborted pending read to reject",
      );
      assertStrictEquals(error, reason);
      assertStrictEquals(upstreamCancelReason, reason);
    });

    it("propagates read failures without waiting for non-settling upstream cleanup", async () => {
      const failure = new Error("upstream body failed");
      const cancellationStarted = Promise.withResolvers<void>();
      const neverSettles = new Promise<void>(() => {});
      let upstreamCancelReason: unknown;
      const body = new ReadableStream<Uint8Array>();
      const hostileReader = {
        read: () => Promise.reject<ReadableStreamReadResult<Uint8Array>>(failure),
        cancel(reason?: unknown) {
          upstreamCancelReason = reason;
          cancellationStarted.resolve();
          return neverSettles;
        },
        releaseLock() {},
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      Object.defineProperty(body, "getReader", {
        configurable: true,
        value: () => hostileReader,
      });

      const stream = await requestStream({
        url: "https://provider.test/stream",
        fetchImpl: () => Promise.resolve(new Response(body)),
        init: { method: "POST" },
        providerLabel: "Test provider",
        providerKind: "openai",
      });
      const reader = stream.getReader();

      const error = await waitWithin(
        reader.read().then(
          () => undefined,
          (caught) => caught,
        ),
        "the body read failure to propagate",
      );

      assertStrictEquals(error, failure);
      await waitWithin(cancellationStarted.promise, "upstream failure cleanup to start");
      assertStrictEquals(upstreamCancelReason, failure);
    });
  });
});
