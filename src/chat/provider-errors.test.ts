import { assertEquals } from "#std/assert";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProviderError } from "./provider-errors.ts";

describe("chat/provider-errors", () => {
  it("parses gateway problem JSON strings and direct provider problem objects", () => {
    assertEquals(
      parseProviderError(JSON.stringify({
        slug: "insufficient-credits",
        suggestion: "Purchase additional credits or upgrade your subscription plan.",
      })),
      {
        code: "INSUFFICIENT_CREDITS",
        message: "Purchase additional credits or upgrade your subscription plan.",
        status: 402,
      },
    );

    assertEquals(
      parseProviderError({
        slug: "resource-limit-exceeded",
        suggestion: "Reduce the request size.",
      }),
      {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Reduce the request size.",
        status: 402,
      },
    );
  });

  it("parses provider overload, rate-limit, context-length, and credit messages", () => {
    assertEquals(parseProviderError({ type: "overloaded_error", message: "Overloaded" }), {
      code: "OVERLOADED_ERROR",
      message: "Overloaded",
    });
    assertEquals(parseProviderError({ type: "rate_limit_error" }), {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
      status: 429,
    });
    assertEquals(parseProviderError("AI credit limit exceeded"), {
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient AI credits",
      status: 402,
    });
    assertEquals(parseProviderError("prompt is too long"), {
      code: "CONTEXT_LENGTH_EXCEEDED",
      message: "Conversation is too long",
    });
  });

  it("walks nested lastError chains without stack overflows or cycles", () => {
    const errorA: Record<string, unknown> = { message: "outer", lastError: null };
    const errorB: Record<string, unknown> = { message: "inner", lastError: errorA };
    errorA.lastError = errorB;

    assertEquals(parseProviderError(errorA), {
      code: "EXTERNAL_SERVICE_ERROR",
      message: "LLM provider service error",
    });

    assertEquals(
      parseProviderError({
        lastError: { lastError: { type: "overloaded_error", message: "Overloaded" } },
      }),
      {
        code: "OVERLOADED_ERROR",
        message: "Overloaded",
      },
    );
  });
});
