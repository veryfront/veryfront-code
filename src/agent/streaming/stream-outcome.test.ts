import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getStreamErrorMessage,
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
  resolveKnownProviderTerminalError,
  resolveStreamOutcome,
} from "./stream-outcome.ts";
import type { StreamLifecyclePhase, StreamSnapshot } from "./lifecycle/types.ts";

describe("agent/stream-outcome", () => {
  describe("getStreamErrorMessage", () => {
    it("returns the message from an Error", () => {
      assertEquals(getStreamErrorMessage(new Error("boom")), "boom");
    });

    it("returns a string error as-is", () => {
      assertEquals(getStreamErrorMessage("plain failure"), "plain failure");
    });

    it("reads message from a plain object", () => {
      assertEquals(getStreamErrorMessage({ message: "object failure" }), "object failure");
    });

    it("stringifies anything else", () => {
      assertEquals(getStreamErrorMessage(42), "42");
      assertEquals(getStreamErrorMessage(null), "null");
      assertEquals(getStreamErrorMessage({ message: 7 }), "[object Object]");
    });
  });

  describe("isLateProviderBodyReadError", () => {
    it("matches the late body-read failure regardless of case", () => {
      assertEquals(
        isLateProviderBodyReadError(new Error("Error reading a body from connection: reset")),
        true,
      );
      assertEquals(
        isLateProviderBodyReadError("error reading a body from connection"),
        true,
      );
    });

    it("rejects other errors", () => {
      assertEquals(isLateProviderBodyReadError(new Error("connection refused")), false);
      assertEquals(isLateProviderBodyReadError(undefined), false);
    });
  });

  describe("hasCompletedStepSignal", () => {
    it("accepts every completed finish reason", () => {
      for (const reason of ["stop", "length", "tool-calls", "content-filter", "other"]) {
        assertEquals(hasCompletedStepSignal(reason), true, reason);
      }
    });

    it("rejects null, unknown, and error finish reasons", () => {
      assertEquals(hasCompletedStepSignal(null), false);
      assertEquals(hasCompletedStepSignal("error"), false);
      assertEquals(hasCompletedStepSignal("unknown"), false);
    });
  });

  describe("resolveKnownProviderTerminalError", () => {
    it("returns null for the generic provider service error", () => {
      assertEquals(resolveKnownProviderTerminalError(new Error("boom")), null);
    });

    it("returns code and message for a recognized terminal error", () => {
      const error = Object.assign(new Error("schema"), {
        responseBody: "Invalid Veryfront schema: defineSchema missing",
      });

      const resolved = resolveKnownProviderTerminalError(error);
      assertEquals(resolved?.code, "PROJECT_SCHEMA_ERROR");
      assertEquals(typeof resolved?.message, "string");
    });
  });
});

describe("resolveStreamOutcome", () => {
  function snapshot(
    phase: StreamLifecyclePhase,
    finishReason: StreamSnapshot["finishReason"],
    hasStreamOutput: boolean,
  ): StreamSnapshot {
    return {
      phase,
      accumulatedText: hasStreamOutput ? "output" : "",
      reasoning: [],
      tools: [],
      finishReason,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      hasStreamOutput,
      hasSemanticProgress: hasStreamOutput || finishReason !== null,
    };
  }

  it("resolves every terminal path with phase on the outcome and snapshot", () => {
    const cases = [
      { snapshot: snapshot("completed", "stop", true), expected: "completed" },
      {
        snapshot: snapshot("tool_handoff", "tool-calls", true),
        expected: "tool_handoff",
      },
      {
        snapshot: snapshot("streaming", null, true),
        cancellation: "user" as const,
        expected: "cancelled",
      },
      {
        snapshot: snapshot("streaming", null, false),
        thrownError: new Error("provider failed"),
        expected: "failed",
      },
    ];
    for (const input of cases) {
      const outcome = resolveStreamOutcome({ ...input, elapsedMs: 12 });
      assertEquals(outcome.status, input.expected);
      assertEquals(outcome.phase, outcome.snapshot.phase);
    }
  });

  it("keeps late body-read completion behind output and finish gates", () => {
    assertEquals(
      resolveStreamOutcome({
        snapshot: snapshot("completed", "stop", true),
        elapsedMs: 10,
        thrownError: new Error("Error reading a body from connection"),
      }).status,
      "completed",
    );
    assertEquals(
      resolveStreamOutcome({
        snapshot: snapshot("streaming", null, true),
        elapsedMs: 10,
        thrownError: new Error("Error reading a body from connection"),
      }).status,
      "failed",
    );
  });

  it("preserves a recorded lifecycle error and its termination phase", () => {
    const outcome = resolveStreamOutcome({
      snapshot: snapshot("awaiting_tool_input", null, false),
      elapsedMs: 15_000,
      lifecycleError: {
        code: "TOOL_INPUT_TIMEOUT",
        phase: "awaiting_tool_input",
        source: "tool",
        retryable: false,
        publicMessage: "Tool input did not arrive before the deadline",
      },
    });
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "TOOL_INPUT_TIMEOUT");
      assertEquals(outcome.error.phase, "awaiting_tool_input");
    }
    assertEquals(outcome.snapshot.phase, "failed");
  });

  it("maps known provider errors to terminal codes with sanitized messages", () => {
    const outcome = resolveStreamOutcome({
      snapshot: snapshot("streaming", null, false),
      elapsedMs: 5,
      providerError: {
        code: "CONTEXT_WINDOW_EXCEEDED",
        publicMessage: "The request exceeded the model context window",
        retryable: false,
        terminal: true,
      },
    });
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "PROVIDER_TERMINAL_ERROR");
      assertEquals(outcome.error.providerCode, "CONTEXT_WINDOW_EXCEEDED");
      assertEquals(
        outcome.error.publicMessage,
        "The request exceeded the model context window",
      );
    }
  });

  it("treats an unknown thrown value as a retryable sanitized failure", () => {
    const outcome = resolveStreamOutcome({
      snapshot: snapshot("streaming", null, false),
      elapsedMs: 5,
      thrownError: { raw: "socket closed by peer at 10.0.0.1" },
    });
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "PROVIDER_STREAM_ERROR");
      assertEquals(outcome.error.retryable, true);
      assertEquals(
        outcome.error.publicMessage.includes("10.0.0.1"),
        false,
      );
    }
  });
});
