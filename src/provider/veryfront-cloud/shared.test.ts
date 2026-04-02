import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
} from "./shared.ts";

describe("provider/veryfront-cloud/shared", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes provider aliases when parsing model IDs", () => {
    assertEquals(
      parseVeryfrontCloudModelId("google-ai-studio/gemini-2.0-flash", "embedding"),
      {
        provider: "google",
        modelId: "gemini-2.0-flash",
      },
    );
  });

  it("rejects malformed model IDs", () => {
    assertThrows(
      () => parseVeryfrontCloudModelId("openai", "language"),
      Error,
      'Invalid veryfront-cloud model string: "openai"',
    );
  });

  it("builds gateway base URLs without duplicate slashes", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl("https://api.veryfront.com/", "google"),
      "https://api.veryfront.com/ai/gateway/google/v1beta",
    );
  });

  it("rewrites auth headers for the gateway fetch wrapper", async () => {
    let capturedRequest: Request | undefined;
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    const wrappedFetch = createVeryfrontCloudFetch("vf_test_provider");

    await wrappedFetch("https://api.veryfront.com/ai/gateway/openai/v1/chat/completions", {
      headers: {
        Authorization: "Bearer upstream-token",
        "x-api-key": "anthropic-key",
        "x-goog-api-key": "google-key",
        "x-extra-header": "kept",
      },
    });

    assertEquals(capturedRequest?.headers.get("Authorization"), "Bearer vf_test_provider");
    assertEquals(capturedRequest?.headers.get("x-api-key"), null);
    assertEquals(capturedRequest?.headers.get("x-goog-api-key"), null);
    assertEquals(capturedRequest?.headers.get("x-extra-header"), "kept");
  });
});
