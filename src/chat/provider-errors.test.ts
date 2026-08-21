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

  it("classifies upstream provider billing failures separately from user credits", () => {
    const expected = {
      code: "AI_PROVIDER_BILLING_ERROR",
      message:
        "The configured AI provider account cannot process this request. Try a different model, or ask an administrator to check provider billing.",
      status: 502,
    };

    assertEquals(
      parseProviderError({
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      }),
      expected,
    );

    assertEquals(
      parseProviderError(
        'veryfront-cloud request failed: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_test"}',
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

  it("extracts a bounded JSON error envelope from decorated log text", () => {
    assertEquals(
      parseProviderError(
        'request {attempt=1} failed: {"slug":"resource-limit-exceeded","suggestion":"Reduce the request size."} [request_id=req_test]',
      ),
      {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Reduce the request size.",
        status: 402,
      },
    );
  });

  it("bounds deeply nested acyclic provider error envelopes", () => {
    let nestedError: Record<string, unknown> = {
      type: "overloaded_error",
      message: "Too deep to trust",
    };
    let nestedLastError: Record<string, unknown> = {
      type: "overloaded_error",
      message: "Too deep to trust",
    };
    for (let depth = 0; depth < 10_000; depth++) {
      nestedError = { error: nestedError };
      nestedLastError = { lastError: nestedLastError };
    }

    const expected = {
      code: "EXTERNAL_SERVICE_ERROR",
      message: "LLM provider service error",
    };
    assertEquals(parseProviderError(nestedError), expected);
    assertEquals(parseProviderError(nestedLastError), expected);
  });

  describe("structured-output schema rejections", () => {
    /** An error carrying `body` the way buildProviderError attaches it. */
    function providerError(body: unknown): Error {
      const error = new Error("Provider request failed with status 400");
      Object.defineProperty(error, "responseBody", {
        value: JSON.stringify(body),
        enumerable: false,
      });
      return error;
    }

    const OPEN_OBJECT_REJECTION = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false",
      },
    };

    it("names the schema requirement instead of a generic service error", () => {
      // Without a mapping this lands on EXTERNAL_SERVICE_ERROR ("LLM provider
      // service error"), which points nowhere: the caller cannot tell that
      // their own outputSchema is what needs changing.
      assertEquals(parseProviderError(providerError(OPEN_OBJECT_REJECTION)), {
        code: "OUTPUT_SCHEMA_NOT_CLOSED",
        message:
          "The model rejected the output schema because an object in it allows additional properties. Add .strict() to the object in your outputSchema so it sets additionalProperties: false.",
      });
    });

    it("does not echo the provider's raw message", () => {
      // The curated message is the whole point of this layer: provider bodies
      // can quote request content, so they never reach the caller verbatim.
      const parsed = parseProviderError(providerError(OPEN_OBJECT_REJECTION));
      assertEquals(parsed.message.includes("output_config.format.schema"), false);
    });

    it("leaves an unrelated invalid_request_error on the generic path", () => {
      assertEquals(
        parseProviderError(providerError({
          type: "error",
          error: { type: "invalid_request_error", message: "something else entirely" },
        })),
        { code: "EXTERNAL_SERVICE_ERROR", message: "LLM provider service error" },
      );
    });
  });
});
