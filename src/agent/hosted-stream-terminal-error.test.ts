import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  getEmptyHostedFinalizedMessageTerminalError,
  getHostedStreamErrorText,
  shouldFailEmptyHostedFinalizedMessage,
} from "./hosted-stream-terminal-error.ts";

Deno.test("getHostedStreamErrorText extracts message from Error", () => {
  assertEquals(getHostedStreamErrorText(new Error("boom")), "boom");
});

Deno.test("getHostedStreamErrorText returns string errors as-is", () => {
  assertEquals(getHostedStreamErrorText("raw error"), "raw error");
});

Deno.test("getHostedStreamErrorText extracts message from record with message field", () => {
  assertEquals(getHostedStreamErrorText({ message: "from record" }), "from record");
});

Deno.test("getHostedStreamErrorText recognizes credit limit errors", () => {
  assertStringIncludes(getHostedStreamErrorText(new Error("AI credit limit exceeded")), "credit");
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError returns default empty response error", () => {
  const result = getEmptyHostedFinalizedMessageTerminalError({ finalStep: null });
  assertEquals(result.code, "EMPTY_RESPONSE");
  assertStringIncludes(result.message, "without producing a response");
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError returns stream error when present", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      finalStep: null,
      streamError: new Error("connection lost"),
    }),
    { code: "STREAM_ERROR", message: "connection lost" },
  );
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError returns credit error from stream error", () => {
  const result = getEmptyHostedFinalizedMessageTerminalError({
    finalStep: null,
    streamError: JSON.stringify({ slug: "insufficient-credits", suggestion: "Buy credits" }),
  });
  assertEquals(result.code, "INSUFFICIENT_CREDITS");
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError extracts terminal error from final step response body", () => {
  const result = getEmptyHostedFinalizedMessageTerminalError({
    finalStep: {
      response: {
        body: JSON.stringify({ slug: "insufficient-credits", suggestion: "Upgrade plan" }),
      },
    },
  });
  assertEquals(result.code, "INSUFFICIENT_CREDITS");
});

Deno.test("shouldFailEmptyHostedFinalizedMessage fails non-aborted empty assistant responses", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: { parts: [] },
    }),
    true,
  );
});

Deno.test("shouldFailEmptyHostedFinalizedMessage keeps aborted empty assistant responses cancellable", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: true,
      message: { parts: [] },
    }),
    false,
  );
});

Deno.test("shouldFailEmptyHostedFinalizedMessage keeps non-empty assistant responses successful", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: { parts: [{ type: "text", text: "Done" }] },
    }),
    false,
  );
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError prefers a real terminal error from final step response body", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      finalStep: {
        response: {
          body: {
            slug: "insufficient-credits",
            error: "AI credit limit exceeded",
            suggestion: "Purchase additional credits or upgrade your subscription plan.",
          },
        },
      },
    }),
    {
      code: "INSUFFICIENT_CREDITS",
      message: "Purchase additional credits or upgrade your subscription plan.",
    },
  );
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError prefers a streamed provider error over final step fallback", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      streamError: "AI credit limit exceeded",
      finalStep: {
        response: {
          body: {
            slug: "resource-limit-exceeded",
            suggestion: "Reduce the request size.",
          },
        },
      },
    }),
    {
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient AI credits",
    },
  );
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError keeps unknown streamed errors as stream failures", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      streamError: "Provider stream closed unexpectedly",
      finalStep: null,
    }),
    {
      code: "STREAM_ERROR",
      message: "Provider stream closed unexpectedly",
    },
  );
});
