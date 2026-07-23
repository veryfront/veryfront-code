import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider";
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
    assertEquals(parseVeryfrontCloudModelId("mistral/mistral-large-2512", "language"), {
      provider: "mistral",
      modelId: "mistral-large-2512",
    });
  });

  it("rejects malformed model IDs", () => {
    assertThrows(
      () => parseVeryfrontCloudModelId("openai", "language"),
      Error,
      "Invalid veryfront-cloud model string",
    );
    assertThrows(
      () => parseVeryfrontCloudModelId("__proto__/model", "language"),
      Error,
      "Invalid veryfront-cloud model string",
    );
  });

  it("rejects unsupported Mistral model IDs at the provider boundary", () => {
    assertThrows(
      () => parseVeryfrontCloudModelId("mistral/mistral-small-2603", "language"),
      Error,
      "Mistral model is not supported",
    );
    assertThrows(
      () => parseVeryfrontCloudModelId("mistral/mistral-medium-3-5", "language"),
      Error,
      "Mistral model is not supported",
    );
  });

  it("builds gateway base URLs without duplicate slashes", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl("https://api.veryfront.com/", "google"),
      "https://api.veryfront.com/ai/gateway/google/v1beta",
    );
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl("https://api.veryfront.com/", "mistral"),
      "https://api.veryfront.com/ai/gateway/mistral/v1",
    );
  });

  it("rejects unsafe gateway base URLs", () => {
    assertThrows(
      () =>
        getVeryfrontCloudGatewayBaseUrl(
          "https://user:password@api.veryfront.com",
          "openai",
        ),
      Error,
      "base URL",
    );
  });

  it("rejects whitespace-only gateway credentials and project slugs", () => {
    assertThrows(
      () =>
        createVeryfrontCloudFetch(
          "   ",
          undefined,
          "https://api.veryfront.com/ai/gateway/openai/v1",
        ),
      Error,
      "API token is invalid",
    );
    assertThrows(
      () =>
        createVeryfrontCloudFetch(
          "vf_test_provider",
          "   ",
          "https://api.veryfront.com/ai/gateway/openai/v1",
        ),
      Error,
      "project slug is invalid",
    );
  });

  it("rewrites auth headers for the gateway fetch wrapper", async () => {
    let capturedRequest: Request | undefined;
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      undefined,
      "https://api.veryfront.com/ai/gateway/openai/v1",
    );

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
    assertEquals(capturedRequest?.headers.get("x-veryfront-billing-group-id"), null);
    assertEquals(capturedRequest?.redirect, "error");
  });

  it("refuses to attach a gateway token outside the configured gateway", async () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      undefined,
      "https://api.veryfront.com/ai/gateway/openai/v1",
    );

    let caught: unknown;
    try {
      await wrappedFetch("https://attacker.example/collect");
    } catch (error) {
      caught = error;
    }

    assertEquals(caught instanceof Error, true);
    assertEquals((caught as Error).message.includes("vf_test_provider"), false);
    assertEquals(fetchCalled, false);
  });

  it("forwards the request-scoped billing group id to the gateway", async () => {
    let capturedRequest: Request | undefined;
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      undefined,
      "https://api.veryfront.com/ai/gateway/openai/v1",
    );

    await runWithVeryfrontCloudContext(
      { billingGroupId: "evalrun_20260628_kimi" },
      () => wrappedFetch("https://api.veryfront.com/ai/gateway/openai/v1/chat/completions"),
    );

    assertEquals(
      capturedRequest?.headers.get("x-veryfront-billing-group-id"),
      "evalrun_20260628_kimi",
    );
  });
});
