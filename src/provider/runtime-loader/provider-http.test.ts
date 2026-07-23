import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parseProviderError } from "../../chat/provider-errors.ts";
import {
  buildProviderError,
  parseRetryAfterMs,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "./provider-http.ts";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers,
  });
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

    it("fails closed when an oversized OpenAI 429 body is truncated", async () => {
      const err = await buildProviderError(
        "openai",
        jsonResponse(429, {
          error: { code: "insufficient_quota", message: "x".repeat(9_000) },
        }),
      );

      assertEquals(err instanceof ProviderRequestError, true);
      assertEquals(err.retryable, false);
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

    it("google 429 RESOURCE_EXHAUSTED -> non-retryable quota", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED" } }),
      );
      assertEquals(err instanceof ProviderQuotaError, true);
      assertEquals(err.retryable, false);
    });

    it("fails closed when an oversized Google 429 body is truncated", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, {
          error: { status: "RESOURCE_EXHAUSTED", message: "x".repeat(9_000) },
        }),
      );

      assertEquals(err instanceof ProviderRequestError, true);
      assertEquals(err.retryable, false);
    });

    it("google 429 without RESOURCE_EXHAUSTED -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, { error: { status: "ABORTED" } }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
    });

    it("fails closed for unparseable ambiguous 429 bodies", async () => {
      for (const provider of ["openai", "google"] as const) {
        const err = await buildProviderError(provider, jsonResponse(429, "{"));
        assertEquals(err instanceof ProviderRequestError, true, provider);
        assertEquals(err.retryable, false, provider);
      }
    });

    it("generic and reverse-proxy transient 5xx -> retryable overloaded", async () => {
      for (const status of [500, 502, 504, 507, 520, 521, 522, 523, 524, 529]) {
        const err = await buildProviderError("openai", jsonResponse(status, "gateway error"));
        assertEquals(err instanceof ProviderOverloadedError, true, `status ${status}`);
        assertEquals(err.retryable, true, `status ${status}`);
      }
    });

    it("permanent 5xx responses are non-retryable request errors", async () => {
      for (const status of [501, 505]) {
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
});
