import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAnthropicMessagesUrl,
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
} from "./provider-endpoints.ts";

describe("provider/runtime-loader/provider-endpoints", () => {
  it("builds default provider endpoints", () => {
    assertEquals(getAnthropicMessagesUrl(), "https://api.anthropic.com/v1/messages");
    assertEquals(getOpenAIEmbeddingUrl(), "https://api.openai.com/v1/embeddings");
    assertEquals(
      getOpenAIChatCompletionsUrl(),
      "https://api.openai.com/v1/chat/completions",
    );
    assertEquals(getOpenAIResponsesUrl(), "https://api.openai.com/v1/responses");
    assertEquals(
      getGoogleGenerateContentUrl(undefined, "gemini-2.5-flash"),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    assertEquals(
      getGoogleStreamGenerateContentUrl(undefined, "gemini-2.5-flash"),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    assertEquals(
      getGoogleEmbeddingUrl(undefined, "gemini-embedding-2"),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
    );
  });

  it("appends paths while preserving base query parameters and removing fragments", () => {
    assertEquals(
      getOpenAIResponsesUrl(
        "https://gateway.example.test/proxy/v1/?api-version=2026-07-01#fragment",
      ),
      "https://gateway.example.test/proxy/v1/responses?api-version=2026-07-01",
    );
  });

  it("keeps provider-required query parameters separate from the pathname", () => {
    assertEquals(
      getGoogleStreamGenerateContentUrl(
        "https://gateway.example.test/google?region=eu&alt=legacy#fragment",
        "publisher/model",
      ),
      "https://gateway.example.test/google/models/publisher%2Fmodel:streamGenerateContent?region=eu&alt=sse",
    );
  });

  it("rejects non-HTTP base URLs and malformed model IDs", () => {
    for (
      const baseURL of [
        "file:///tmp/provider",
        "javascript:alert(1)",
        "not a URL",
      ]
    ) {
      assertThrows(
        () => getOpenAIResponsesUrl(baseURL),
        TypeError,
        "Provider base URL",
      );
    }
    for (const modelId of ["", " model", "model "]) {
      assertThrows(
        () => getGoogleGenerateContentUrl(undefined, modelId),
        TypeError,
        "non-empty trimmed string",
      );
    }
  });

  it("rejects base URLs that embed credentials in the userinfo", () => {
    assertThrows(
      () => getOpenAIResponsesUrl("https://token-only@gateway.example.test/v1"),
      TypeError,
      "must not contain embedded credentials",
      "a username-only userinfo must be rejected by the credentials branch",
    );
    assertThrows(
      () => getOpenAIResponsesUrl("https://user:private-password@gateway.example.test/v1"),
      TypeError,
      "must not contain embedded credentials",
      "a user:password userinfo must be rejected by the credentials branch",
    );
  });
});
