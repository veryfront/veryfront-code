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

  it("rejects active-content authentication URLs", () => {
    for (
      const connectUrl of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://user:password@example.test/oauth/connect",
        "https://example.test/oauth/connect\nunsafe",
      ]
    ) {
      const result = {
        error: "authentication_required",
        integration: "gmail",
        connectUrl,
      };
      assertEquals(isIntegrationAuthenticationActionResult(result), false);
      assertEquals(
        getToolResultError(result),
        "Integration authentication response is incomplete",
      );
    }

    for (
      const connectUrl of [
        "/api/auth/gmail",
        "//auth.example.test/oauth/connect/gmail",
        "https://auth.example.test/oauth/connect/gmail",
      ]
    ) {
      assertEquals(
        isIntegrationAuthenticationActionResult({
          error: "authentication_required",
          integration: "gmail",
          connectUrl,
        }),
        true,
      );
    }
  });

  it("uses a stable diagnostic for empty error markers", () => {
    assertEquals(getToolResultError({ error: "" }), "Tool execution failed");
    assertEquals(getToolResultError({ error: "   " }), "Tool execution failed");
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

  it("does not invoke accessor-backed result markers", () => {
    let getterCalled = false;
    const result = Object.defineProperties({}, {
      error: {
        enumerable: true,
        get() {
          getterCalled = true;
          throw new Error("must not execute");
        },
      },
      output: {
        enumerable: true,
        get() {
          getterCalled = true;
          throw new Error("must not execute");
        },
      },
    });

    assertEquals(hasToolExecutionErrorMarker(result), false);
    assertEquals(isErroredToolExecutionResult(result), false);
    assertEquals(getToolResultError(result), undefined);
    assertEquals(getterCalled, false);
  });
});
