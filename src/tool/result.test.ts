import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getToolResultError,
  hasToolExecutionErrorMarker,
  isErroredToolExecutionResult,
  isIntegrationAuthenticationActionResult,
} from "./result.ts";

describe("tool/result", () => {
  it("detects standard error markers on tool result objects", () => {
    assertEquals(hasToolExecutionErrorMarker({ error: "failed" }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: true }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: false }), false);
    assertEquals(hasToolExecutionErrorMarker({ error: { message: "failed" } }), false);
    assertEquals(hasToolExecutionErrorMarker("failed"), false);
  });

  it("detects errored execution results from direct or nested output markers", () => {
    assertEquals(isErroredToolExecutionResult({ error: "failed" }), true);
    assertEquals(isErroredToolExecutionResult({ isError: true }), true);
    assertEquals(isErroredToolExecutionResult({ output: { error: "failed" } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { isError: true } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { ok: true } }), false);
    assertEquals(isErroredToolExecutionResult({ ok: true }), false);
  });

  it("recognizes only complete integration authentication actions", () => {
    const authenticationRequired = {
      error: "authentication_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail",
    };
    const reconnectRequired = {
      error: "reconnect_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail",
      message: "Reconnect Gmail to continue.",
    };

    assertEquals(isIntegrationAuthenticationActionResult(authenticationRequired), true);
    assertEquals(isIntegrationAuthenticationActionResult(reconnectRequired), true);
    assertEquals(getToolResultError(authenticationRequired), undefined);
    assertEquals(getToolResultError(reconnectRequired), undefined);

    const incompleteActions = [
      {
        error: "authentication_required",
        integration: "",
        connectUrl: "https://api.example.test/oauth/connect/gmail",
      },
      {
        error: "authentication_required",
        integration: "gmail",
        connectUrl: " ",
      },
      {
        error: "authentication_required",
        integration: "gmail",
      },
    ];
    for (const incompleteAction of incompleteActions) {
      assertEquals(isIntegrationAuthenticationActionResult(incompleteAction), false);
      assertEquals(
        getToolResultError(incompleteAction),
        "Integration authentication response is incomplete",
      );
    }

    assertEquals(
      isIntegrationAuthenticationActionResult({
        error: "tool_error",
        integration: "gmail",
        connectUrl: "https://api.example.test/oauth/connect/gmail",
      }),
      false,
    );
    assertEquals(
      getToolResultError({
        error: "authentication_required",
        integration: "",
        message: "Authentication required for Gmail.",
      }),
      "Authentication required for Gmail.",
    );
  });

  it("keeps ordinary structured errors on the error path", () => {
    assertEquals(
      getToolResultError({
        error: "rate_limited",
        message: "Too many requests.",
        isError: true,
      }),
      "Too many requests.",
    );
  });
});
