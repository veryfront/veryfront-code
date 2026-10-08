import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  getEmptyHostedFinalizedMessageTerminalError,
  getHostedStreamErrorText,
  shouldFailEmptyHostedFinalizedMessage,
} from "./stream-terminal-error.ts";

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

Deno.test("getHostedStreamErrorText makes hosted stream timeouts transparent", () => {
  assertEquals(
    getHostedStreamErrorText(new Error("Stream timed out after 5 minutes")),
    "This run timed out after 5 minutes before the agent finished. Try again to continue, or narrow the request.",
  );
});

Deno.test("getHostedStreamErrorText makes bootstrap stream timeouts transparent", () => {
  assertEquals(
    getHostedStreamErrorText(new Error("Chat stream bootstrap timeout after 90000ms")),
    "This run timed out after 90 seconds before the agent finished. Try again to continue, or narrow the request.",
  );
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

Deno.test("getEmptyHostedFinalizedMessageTerminalError returns stream timeout when present", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      finalStep: null,
      streamError: new Error("Chat stream idle timeout after 300000ms during tool_running"),
    }),
    {
      code: "STREAM_TIMEOUT",
      message:
        "This run timed out after 5 minutes before the agent finished. Try again to continue, or narrow the request.",
    },
  );
});

Deno.test("getEmptyHostedFinalizedMessageTerminalError preserves unsupported assistant prefill provider errors", () => {
  assertEquals(
    getEmptyHostedFinalizedMessageTerminalError({
      finalStep: null,
      streamError:
        'veryfront-cloud request failed: {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support assistant message prefill. The conversation must end with a user message."}}',
    }),
    {
      code: "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
      message:
        "The selected model does not support assistant-message prefill. Start a new user message or choose a compatible model.",
    },
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

Deno.test("shouldFailEmptyHostedFinalizedMessage fails runtime-metadata-only responses", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: {
        parts: [{
          type: "data-veryfront.runtime_context",
          data: {
            currentDateUtc: "2026-10-07",
            currentTimeUtc: "09:30:41",
            runStartedAtUtc: "2026-10-07T09:30:40.526Z",
          },
        }],
      },
    }),
    true,
  );
});

Deno.test("shouldFailEmptyHostedFinalizedMessage ignores stream framing beside runtime metadata", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: {
        parts: [
          { type: "step-start" },
          { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
        ],
      },
    }),
    true,
  );
});

Deno.test("blank streamed text shells do not make an empty response successful", () => {
  for (const text of ["", " \n\t"]) {
    const message = {
      parts: [{ type: "data-veryfront.runtime_context", data: {} }, { type: "text", text }],
    };
    assertEquals(shouldFailEmptyHostedFinalizedMessage({ isAborted: false, message }), true);
    assertEquals(shouldFailEmptyHostedFinalizedMessage({ isAborted: true, message }), false);
  }
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

Deno.test("shouldFailEmptyHostedFinalizedMessage keeps form data responses successful", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: {
        parts: [{
          type: "data-form_input",
          data: { requestId: "input-request-1" },
        }],
      },
    }),
    false,
  );
});

Deno.test("shouldFailEmptyHostedFinalizedMessage keeps text beside runtime metadata successful", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: {
        parts: [
          { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
          { type: "text", text: "Done" },
        ],
      },
    }),
    false,
  );
});

Deno.test("shouldFailEmptyHostedFinalizedMessage keeps tool output beside runtime metadata successful", () => {
  assertEquals(
    shouldFailEmptyHostedFinalizedMessage({
      isAborted: false,
      message: {
        parts: [
          { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
          {
            type: "dynamic-tool",
            toolName: "search",
            toolCallId: "tool-call-1",
            state: "output-available",
            output: { result: "found" },
          },
        ],
      },
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
      message:
        "Insufficient AI credits. Purchase additional credits or upgrade your subscription plan.",
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

Deno.test("empty streamed reasoning shells do not make an empty response successful", () => {
  for (const extra of [{}, { signature: "" }, { redactedData: "" }]) {
    const message = {
      parts: [{ type: "data-veryfront.runtime_context" }, {
        type: "reasoning",
        text: "",
        ...extra,
      }],
    };
    assertEquals(shouldFailEmptyHostedFinalizedMessage({ isAborted: false, message }), true);
    assertEquals(shouldFailEmptyHostedFinalizedMessage({ isAborted: true, message }), false);
  }
  for (const extra of [{ signature: "sig" }, { redactedData: "opaque" }, { text: " " }]) {
    assertEquals(
      shouldFailEmptyHostedFinalizedMessage({
        isAborted: false,
        message: { parts: [{ type: "reasoning", text: "", ...extra }] },
      }),
      false,
    );
  }
});
