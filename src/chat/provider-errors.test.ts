import "#veryfront/schemas/_test-setup.ts";
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

  it("classifies provider spend limits separately from user credit balance", () => {
    const expected = {
      code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
      message:
        "The AI provider spend limit has been reached. Try again later or ask an administrator to raise the AI provider spend limit.",
      status: 402,
    };

    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "AI provider spend limit exceeded for the daily window.",
        suggestion: "Try again later or ask an administrator to raise the AI provider spend limit.",
        balance: 1,
        required: 2,
      }),
      expected,
    );

    assertEquals(
      parseProviderError(
        'veryfront-cloud request failed: {"slug":"insufficient-credits","error":"AI provider spend limit exceeded for the daily window.","suggestion":"Try again later or ask an administrator to raise the AI provider spend limit.","balance":1,"required":2}',
      ),
      expected,
    );
  });

  it("classifies unsupported assistant prefill provider rejections as model capability errors", () => {
    const expected = {
      code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
      message:
        "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
    };

    assertEquals(
      parseProviderError({
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "This model does not support assistant message prefill. The conversation must end with a user message.",
        },
      }),
      expected,
    );

    assertEquals(
      parseProviderError(
        'veryfront-cloud request failed: {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support assistant message prefill. The conversation must end with a user message."}}',
      ),
      expected,
    );
  });

  it("classifies invalid Veryfront schema errors as project code validation failures", () => {
    const expected = {
      code: "PROJECT_SCHEMA_ERROR",
      message:
        "Project code has an invalid Veryfront schema. Update the schema to use defineSchema(), then run the agent again.",
    };

    assertEquals(
      parseProviderError(new Error("Invalid Veryfront schema: use defineSchema()")),
      expected,
    );
    assertEquals(
      parseProviderError({ responseBody: "Invalid Veryfront schema: use defineSchema()" }),
      expected,
    );
  });

  it("classifies provider assistant-prefill rejections", () => {
    const expected = {
      code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
      message:
        "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
    };

    assertEquals(
      parseProviderError({
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "This model does not support assistant message prefill. The conversation must end with a user message.",
          },
          request_id: "req_test",
        }),
      }),
      expected,
    );

    assertEquals(
      parseProviderError(
        "veryfront-cloud request failed: " + JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "This model does not support assistant message prefill. The conversation must end with a user message.",
          },
        }),
      ),
      expected,
    );

    assertEquals(
      parseProviderError({
        lastError: {
          responseBody: JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "This model does not support assistant message prefill. The conversation must end with a user message.",
            },
          }),
        },
      }),
      expected,
    );
  });

  it("guards cyclic nested provider error envelopes", () => {
    const cyclicError: Record<string, unknown> = {};
    cyclicError.error = cyclicError;

    assertEquals(parseProviderError(cyclicError), {
      code: "EXTERNAL_SERVICE_ERROR",
      message: "LLM provider service error",
    });
  });

  it("does not overmatch unrelated invalid request messages", () => {
    assertEquals(
      parseProviderError({
        type: "invalid_request_error",
        message: "The conversation must end with a user message before tool output.",
      }),
      {
        code: "EXTERNAL_SERVICE_ERROR",
        message: "LLM provider service error",
      },
    );
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
