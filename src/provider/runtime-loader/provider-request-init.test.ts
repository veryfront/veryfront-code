import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAnthropicRequestHeaders,
  createAnthropicRequestInit,
  createGoogleRequestInit,
  createOpenAIRequestInit,
} from "./provider-request-init.ts";

describe("provider/runtime-loader/provider-request-init", () => {
  it("rejects missing OpenAI and Google credentials", () => {
    assertThrows(
      () => createOpenAIRequestInit({ apiKey: "", body: "{}" }),
      TypeError,
      "Provider credential is invalid",
    );
    assertThrows(
      () => createGoogleRequestInit({ apiKey: "", body: "{}" }),
      TypeError,
      "Provider credential is invalid",
    );
    assertThrows(
      () => createOpenAIRequestInit({ apiKey: "   ", body: "{}" }),
      TypeError,
      "Provider credential is invalid",
    );
  });

  it("rejects missing and malformed Anthropic credentials", () => {
    assertThrows(() => createAnthropicRequestHeaders({}), TypeError, "credential");
    assertThrows(
      () => createAnthropicRequestHeaders({ apiKey: "key\nprivate" }),
      TypeError,
      "credential",
    );
  });

  it("removes the inactive Anthropic credential header", () => {
    const tokenHeaders = new Headers(
      createAnthropicRequestInit({
        authToken: "oauth-token",
        extraHeaders: { "x-api-key": "caller-key" },
        body: "{}",
      }).headers,
    );
    assertEquals(tokenHeaders.get("authorization"), "Bearer oauth-token");
    assertEquals(tokenHeaders.has("x-api-key"), false);

    const apiKeyHeaders = new Headers(
      createAnthropicRequestInit({
        apiKey: "provider-key",
        extraHeaders: { authorization: "Bearer caller-token" },
        body: "{}",
      }).headers,
    );
    assertEquals(apiKeyHeaders.get("x-api-key"), "provider-key");
    assertEquals(apiKeyHeaders.has("authorization"), false);
  });

  it("enables Anthropic fine-grained tool streaming on streaming requests", () => {
    const headers = createAnthropicRequestHeaders({
      apiKey: "test-anthropic-key",
      enableFineGrainedToolStreaming: true,
    });

    assertEquals(headers.get("anthropic-beta"), "fine-grained-tool-streaming-2025-05-14");
    assertEquals(headers.get("x-api-key"), "test-anthropic-key");
    assertEquals(headers.get("anthropic-version"), "2023-06-01");
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
});
