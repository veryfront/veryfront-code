import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseProviderError } from "./provider-errors.ts";
import { buildProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";

describe("chat/provider-errors", () => {
  it("does not expose provider text from recognized problem bodies", async () => {
    for (const slug of ["insufficient-credits", "resource-limit-exceeded"]) {
      const problem = {
        slug,
        error: "private prompt fragment",
        suggestion: "private provider diagnostic",
      };
      const expected = {
        code: slug === "insufficient-credits" ? "INSUFFICIENT_CREDITS" : "RESOURCE_LIMIT_EXCEEDED",
        message: slug === "insufficient-credits"
          ? "Insufficient AI credits"
          : "Resource limit exceeded",
        status: 402,
      };

      assertEquals(parseProviderError(problem), expected);
      assertEquals(
        parseProviderError(
          await buildProviderError(
            "openai",
            new Response(JSON.stringify(problem), {
              status: 402,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
        expected,
      );
    }
  });

  it("parses gateway problem JSON strings and direct provider problem objects", () => {
    assertEquals(
      parseProviderError(JSON.stringify({
        slug: "insufficient-credits",
        suggestion: "Purchase additional credits or upgrade your subscription plan.",
      })),
      {
        code: "INSUFFICIENT_CREDITS",
        message: "Insufficient AI credits",
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
        message: "Resource limit exceeded",
        status: 402,
      },
    );
  });

  it("preserves required and available credits for gateway credit failures", async () => {
    const responseBody = JSON.stringify({
      slug: "insufficient-credits",
      error: "Agent run credit limit exceeded",
      suggestion: "Start a new reviewed run or reduce the scope of this run.",
      balance: 57.25,
      required: 85.5,
    });
    const error = await buildProviderError(
      "openai",
      new Response(responseBody, {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );

    assertEquals(parseProviderError(error), {
      code: "INSUFFICIENT_CREDITS",
      message:
        "Agent run credit limit exceeded: 85.5 credits required, 57.25 remaining. Start a new reviewed run or reduce the scope of this run.",
      status: 402,
    });

    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "AI credit limit exceeded",
        suggestion: "Purchase additional credits or upgrade your subscription plan.",
        balance: 12,
        required: 20,
      }),
      {
        code: "INSUFFICIENT_CREDITS",
        message:
          "AI credit limit exceeded: 20 credits required, 12 available. Purchase additional credits or upgrade your subscription plan.",
        status: 402,
      },
    );
  });

  it("keeps validated credit amounts without copying private problem text", () => {
    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "private prompt fragment",
        suggestion: "private provider diagnostic",
        balance: 12,
        required: 20,
      }),
      {
        code: "INSUFFICIENT_CREDITS",
        message:
          "Insufficient AI credits: 20 credits required, 12 available. Purchase additional credits or upgrade your subscription plan.",
        status: 402,
      },
    );
    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "Agent run credit limit exceeded: private prompt fragment",
        suggestion: "private provider diagnostic",
        balance: 57.25,
        required: 85.5,
      }),
      {
        code: "INSUFFICIENT_CREDITS",
        message:
          "Agent run credit limit exceeded: 85.5 credits required, 57.25 remaining. Start a new reviewed run or reduce the scope of this run.",
        status: 402,
      },
    );
  });

  it("falls back safely when gateway credit values are invalid", () => {
    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "Agent run credit limit exceeded",
        suggestion: "Start a new reviewed run.",
        balance: "57.25",
        required: 85.5,
      }),
      {
        code: "INSUFFICIENT_CREDITS",
        message: "Agent run credit limit exceeded",
        status: 402,
      },
    );

    assertEquals(
      parseProviderError({
        slug: "insufficient-credits",
        error: "AI credit limit exceeded",
        balance: 12,
        required: -1,
      }),
      {
        code: "INSUFFICIENT_CREDITS",
        message: "Insufficient AI credits",
        status: 402,
      },
    );
  });

  it("parses provider overload, rate-limit, context-length, and credit messages", () => {
    assertEquals(parseProviderError({ type: "overloaded_error", message: "Overloaded" }), {
      code: "OVERLOADED_ERROR",
      message: "The LLM provider is currently overloaded",
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
    assertEquals(
      parseProviderError(new Error("429 Too Many Requests")),
      {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
        status: 429,
      },
      "a rate limit named only in the message text must still carry status 429",
    );
    assertEquals(
      parseProviderError("Provider is over capacity"),
      {
        code: "OVERLOADED_ERROR",
        message: "The LLM provider is currently overloaded",
      },
      "an overload named only in the message text must classify as OVERLOADED_ERROR",
    );
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
        message: "The LLM provider is currently overloaded",
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
        message: "Resource limit exceeded",
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

    const EXPECTED = {
      code: "OUTPUT_SCHEMA_NOT_CLOSED",
      message:
        "The provider rejected the output schema because an object in it allows additional properties. " +
        "Set additionalProperties: false on that object -- add .strict() if the outputSchema was " +
        "built with defineSchema(), or set the property directly on a raw JSON Schema.",
    };

    it("names the schema requirement instead of a generic service error", () => {
      // Without a mapping this lands on EXTERNAL_SERVICE_ERROR ("LLM provider
      // service error"), which points nowhere: the caller cannot tell that
      // their own outputSchema is what needs changing.
      assertEquals(parseProviderError(providerError(OPEN_OBJECT_REJECTION)), EXPECTED);
    });

    it("matches OpenAI's wording for the same rejection", () => {
      assertEquals(
        parseProviderError(providerError({
          error: {
            type: "invalid_request_error",
            message:
              "Invalid schema for response_format 'Person': In context=(), 'additionalProperties' is required to be supplied and to be false.",
          },
        })),
        EXPECTED,
      );
    });

    it("does not claim a tool schema rejection is about the output schema", () => {
      // Providers reject open objects in tool/function schemas with a nearly
      // identical sentence. Sending the caller to fix `outputSchema` would be
      // pointing at the wrong schema entirely.
      assertEquals(
        parseProviderError(providerError({
          error: {
            type: "invalid_request_error",
            message:
              "Invalid schema for function 'lookup': In context=(), 'additionalProperties' is required to be supplied and to be false.",
          },
        })),
        { code: "EXTERNAL_SERVICE_ERROR", message: "LLM provider service error" },
      );
    });

    it("gives raw JSON Schema callers a remediation they can apply", () => {
      // `.strict()` exists only on schema-builder objects; outputSchema also
      // accepts a plain JSON Schema, where the fix is the property itself.
      const { message } = parseProviderError(providerError(OPEN_OBJECT_REJECTION));
      assertEquals(message.includes("additionalProperties: false"), true);
      assertEquals(message.includes(".strict()"), true);
    });

    it("does not echo the provider's raw message", () => {
      // The curated message is the whole point of this layer: provider bodies
      // can quote request content, so they never reach the caller verbatim.
      const parsed = parseProviderError(providerError(OPEN_OBJECT_REJECTION));
      assertEquals(parsed.message.includes("output_config.format.schema"), false);
    });

    it("matches when the rejection arrives as a bare error message", () => {
      // The body is only preserved for a structured 400. An unparsed shape, a
      // truncated read, or a provider whose envelope carries no
      // `invalid_request_error` type reaches here as a plain Error instead.
      assertEquals(
        parseProviderError(
          new Error(
            "Invalid schema for response_format 'Person': In context=(), 'additionalProperties' is required to be supplied and to be false.",
          ),
        ),
        EXPECTED,
      );
    });

    it("does not claim a bare tool schema error is about the output schema", () => {
      assertEquals(
        parseProviderError(
          new Error(
            "Invalid schema for function 'lookup': In context=(), 'additionalProperties' is required to be supplied and to be false.",
          ),
        ),
        { code: "EXTERNAL_SERVICE_ERROR", message: "LLM provider service error" },
      );
    });

    describe("through the real buildProviderError", () => {
      function jsonResponse(status: number, body: unknown): Response {
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }

      it("classifies an Anthropic rejection end to end", async () => {
        // The hand-built responseBody in the tests above bypasses the real
        // preservation criteria. This one goes through them.
        const error = await buildProviderError(
          "anthropic",
          jsonResponse(400, OPEN_OBJECT_REJECTION),
        );

        assertEquals(error.message, "Provider request failed with status 400");
        assertEquals(parseProviderError(error), EXPECTED);
      });

      it("classifies a Google rejection end to end", async () => {
        // Google's envelope is `{error:{code,status,message}}` with no `type`
        // at all, so both halves have to recognise `INVALID_ARGUMENT`: the
        // body is preserved for classification, and the classifier reads the
        // shape it arrives in. Either half alone leaves this on the generic
        // path.
        const error = await buildProviderError(
          "google",
          jsonResponse(400, {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message:
                "Invalid schema for response_format: 'additionalProperties' is required to be supplied and to be false.",
            },
          }),
        );

        assertEquals(error.message, "Provider request failed with status 400");
        assertEquals(parseProviderError(error), EXPECTED);
      });

      it("reaches the rest of the curated mappings from Google's envelope too", async () => {
        // The gap was never specific to the output-schema mapping: with the
        // body dropped, *every* curated mapping was unreachable for Google.
        // A second mapping proves the whole family is now in reach, not one
        // special-cased sentence.
        const error = await buildProviderError(
          "google",
          jsonResponse(400, {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "This model does not support assistant message prefill.",
            },
          }),
        );

        assertEquals(parseProviderError(error), {
          code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
          message:
            "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
        });
      });

      it("still drops a 400 whose envelope names no rejection reason", async () => {
        // Widening preservation stays per recognised envelope. A 400 that
        // identifies itself as something else is retained no more than before,
        // so provider bodies are not blanket-retained by status alone.
        const error = await buildProviderError(
          "google",
          jsonResponse(400, {
            error: {
              code: 400,
              status: "UNKNOWN",
              message: "private provider payload <TOKEN>",
            },
          }),
        );

        assertEquals(error.responseBody, undefined);
        assertEquals(JSON.stringify(error).includes("<TOKEN>"), false);
        assertEquals(parseProviderError(error), {
          code: "EXTERNAL_SERVICE_ERROR",
          message: "LLM provider service error",
        });
      });

      it("does not echo a preserved Google body into the message", async () => {
        // The preserved body is classification-only. Widening what gets
        // retained must not widen what the caller is shown.
        const error = await buildProviderError(
          "google",
          jsonResponse(400, {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "Invalid schema for response_format: private payload <TOKEN>",
            },
          }),
        );

        assertEquals(error.message, "Provider request failed with status 400");
        assertEquals(error.message.includes("<TOKEN>"), false);
        assertEquals(Object.keys(error).includes("responseBody"), false);
        assertEquals(JSON.stringify(error).includes("<TOKEN>"), false);
      });
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
