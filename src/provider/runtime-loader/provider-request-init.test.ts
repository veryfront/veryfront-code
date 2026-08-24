import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAnthropicRequestHeaders,
  createGoogleRequestInit,
  createOpenAIRequestInit,
} from "./provider-request-init.ts";

describe("provider/runtime-loader/provider-request-init", () => {
  it("enables Anthropic fine-grained tool streaming on streaming requests", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableFineGrainedToolStreaming: true,
    });

    assertEquals(headers.get("anthropic-beta"), "fine-grained-tool-streaming-2025-05-14");
    assertEquals(headers.get("x-api-key"), "test-anthropic-key");
    assertEquals(headers.get("anthropic-version"), "2023-06-01");
  });

  it("lets a caller-supplied Anthropic API version override the built-in default", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      extraHeaders: { "anthropic-version": "2026-02-01" },
    });

    assertEquals(
      headers.get("anthropic-version"),
      "2026-02-01",
      "a caller-supplied anthropic-version must win over the built-in default",
    );
  });

  it("merges the fine-grained tool streaming beta with caller-supplied Anthropic betas", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableFineGrainedToolStreaming: true,
      extraHeaders: {
        "anthropic-beta": "mcp-client-2025-04-04, context-management-2025-06-27",
      },
    });

    assertEquals(
      headers.get("anthropic-beta"),
      "mcp-client-2025-04-04,context-management-2025-06-27,fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("does not duplicate the fine-grained tool streaming beta when callers already provide it", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableFineGrainedToolStreaming: true,
      extraHeaders: {
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14, mcp-client-2025-04-04",
      },
    });

    assertEquals(
      headers.get("anthropic-beta"),
      "fine-grained-tool-streaming-2025-05-14,mcp-client-2025-04-04",
    );
  });

  it("adds the current Anthropic MCP beta while preserving unrelated caller betas", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableMcpConnector: true,
      extraHeaders: {
        "anthropic-beta": "context-management-2025-06-27, mcp-client-2025-04-04, skills-2025-10-02",
      },
    });

    assertEquals(
      headers.get("anthropic-beta"),
      "context-management-2025-06-27,skills-2025-10-02,mcp-client-2025-11-20",
    );
  });

  it("deduplicates current MCP and streaming betas when both features are enabled", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableMcpConnector: true,
      enableFineGrainedToolStreaming: true,
      extraHeaders: {
        "anthropic-beta":
          "mcp-client-2025-11-20, fine-grained-tool-streaming-2025-05-14, custom-beta",
      },
    });

    assertEquals(
      headers.get("anthropic-beta"),
      "mcp-client-2025-11-20,fine-grained-tool-streaming-2025-05-14,custom-beta",
    );
  });

  it("uses only bearer authentication when an Anthropic auth token is selected", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "ignored-api-key",
      authToken: "oauth-token",
      extraHeaders: {
        "x-api-key": "stale-api-key",
      },
    });

    assertEquals(headers.get("authorization"), "Bearer oauth-token");
    assertEquals(headers.get("x-api-key"), null);
  });

  it("uses only API-key authentication when an Anthropic API key is selected", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "active-api-key",
      extraHeaders: {
        authorization: "Bearer stale-token",
      },
    });

    assertEquals(headers.get("x-api-key"), "active-api-key");
    assertEquals(headers.get("authorization"), null);
  });

  it("resolved credentials outrank caller-supplied auth headers", () => {
    const openai = new Headers(
      createOpenAIRequestInit({
        apiKey: "real",
        body: "{}",
        extraHeaders: { authorization: "Bearer stale", "content-type": "text/plain" },
      }).headers,
    );

    assertEquals(
      openai.get("authorization"),
      "Bearer real",
      "the resolved OpenAI key must overwrite a caller authorization header",
    );
    assertEquals(
      openai.get("content-type"),
      "application/json",
      "content-type must be forced to application/json",
    );

    const google = new Headers(
      createGoogleRequestInit({
        apiKey: "real",
        body: "{}",
        extraHeaders: { "x-goog-api-key": "stale" },
      }).headers,
    );

    assertEquals(
      google.get("x-goog-api-key"),
      "real",
      "the resolved Google key must overwrite a caller x-goog-api-key header",
    );
  });

  it("rejects malformed or oversized provider credentials before building headers", () => {
    const invalidCredentials = [
      "",
      " leading",
      "trailing ",
      "line\nbreak",
      "non-ascii-\u00e5",
      "x".repeat(8 * 1024 + 1),
    ];

    for (const credential of invalidCredentials) {
      assertThrows(
        () =>
          createOpenAIRequestInit({
            apiKey: credential,
            body: "{}",
          }),
        Error,
        "OpenAI API key",
      );
      assertThrows(
        () =>
          createGoogleRequestInit({
            apiKey: credential,
            body: "{}",
          }),
        Error,
        "Google API key",
      );
      assertThrows(
        () =>
          createAnthropicRequestHeaders({
            authToken: credential,
          }),
        Error,
        "Anthropic auth token",
      );
    }
  });
});
