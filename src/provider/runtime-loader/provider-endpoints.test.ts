import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
  getOpenAIChatCompletionsUrl,
} from "./provider-endpoints.ts";

describe("provider/runtime-loader/provider-endpoints", () => {
  it("rejects base URLs containing credentials or unsafe schemes", () => {
    for (const baseURL of ["https://user:password@provider.example/v1", "file:///tmp/provider"]) {
      assertThrows(() => getOpenAIChatCompletionsUrl(baseURL), TypeError, "base URL");
    }
  });

  it("preserves configured query parameters when appending endpoints", () => {
    assertEquals(
      getOpenAIChatCompletionsUrl("https://provider.example/v1?api-version=2026-01-01"),
      "https://provider.example/v1/chat/completions?api-version=2026-01-01",
    );
  });

  it("merges endpoint query parameters with configured query parameters", () => {
    assertEquals(
      getGoogleStreamGenerateContentUrl(
        "https://provider.example/v1beta?tenant=test",
        "model/name",
      ),
      "https://provider.example/v1beta/models/model%2Fname:streamGenerateContent?tenant=test&alt=sse",
    );
  });

  it("rejects malformed Google model IDs before building URLs", () => {
    for (const modelId of ["", "model\nprivate", "x".repeat(4_097)]) {
      assertThrows(
        () => getGoogleGenerateContentUrl(undefined, modelId),
        TypeError,
        "model ID",
      );
    }
  });
});
