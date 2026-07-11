import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
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

    it("google 429 without RESOURCE_EXHAUSTED -> retryable rate limit", async () => {
      const err = await buildProviderError(
        "google",
        jsonResponse(429, { error: { status: "ABORTED" } }),
      );
      assertEquals(err instanceof ProviderRateLimitError, true);
      assertEquals(err.retryable, true);
    });

    it("generic transient 5xx (500/502/504) -> retryable overloaded", async () => {
      for (const status of [500, 502, 504]) {
        const err = await buildProviderError("openai", jsonResponse(status, "gateway error"));
        assertEquals(err instanceof ProviderOverloadedError, true, `status ${status}`);
        assertEquals(err.retryable, true, `status ${status}`);
      }
    });

    it("non-retryable 4xx -> ProviderRequestError", async () => {
      for (const status of [400, 401, 403, 404]) {
        const err = await buildProviderError("openai", jsonResponse(status, "bad request"));
        assertEquals(err instanceof ProviderRequestError, true, `status ${status}`);
        assertEquals(err.retryable, false, `status ${status}`);
      }
    });

    it("bounds the error message to the max body length", async () => {
      const huge = "x".repeat(10_000);
      const err = await buildProviderError("openai", jsonResponse(500, huge));
      assertEquals(err.message.length <= 2_000, true);
    });

    it("falls back to status text when the body is empty", async () => {
      const err = await buildProviderError("openai", new Response("", { status: 500 }));
      assertEquals(err.message.length > 0, true);
    });
  });
});
