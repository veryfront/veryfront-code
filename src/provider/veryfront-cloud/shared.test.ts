import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "./shared.ts";

describe("provider/veryfront-cloud/shared", () => {
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
      'Invalid veryfront-cloud model string: "openai"',
    );
    for (const modelId of ["openai/ gpt-5.5", "openai/gpt-5.5 ", "openai/ "]) {
      assertThrows(
        () => parseVeryfrontCloudModelId(modelId, "language"),
        Error,
        `Invalid veryfront-cloud model string: "${modelId}"`,
      );
    }
  });

  it("rejects object-prototype names as provider aliases", () => {
    for (const provider of ["constructor", "toString", "valueOf", "__proto__"]) {
      assertThrows(
        () => parseVeryfrontCloudModelId(`${provider}/model`, "language"),
        Error,
        `Invalid veryfront-cloud model string: "${provider}/model"`,
      );
    }
  });

  it("rejects unsupported Mistral model IDs at the provider boundary", () => {
    assertThrows(
      () => parseVeryfrontCloudModelId("mistral/mistral-small-2603", "language"),
      Error,
      'Unsupported Mistral model "mistral/mistral-small-2603"',
    );
    assertThrows(
      () => parseVeryfrontCloudModelId("mistral/mistral-medium-3-5", "language"),
      Error,
      'Unsupported Mistral model "mistral/mistral-medium-3-5"',
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

  it("routes run-scoped inference credentials to the trusted public API base", () => {
    setEnv(
      "VERYFRONT_PUBLIC_API_BASE_URL",
      "https://api.staging.veryfront.example",
    );
    try {
      runWithVeryfrontCloudContext(
        { apiBaseUrl: "http://control-plane.internal.example" },
        () => {
          assertEquals(
            requireVeryfrontCloudBootstrap("run-scoped-inference-token").apiBaseUrl,
            "https://api.staging.veryfront.example",
          );
        },
      );
    } finally {
      deleteEnv("VERYFRONT_PUBLIC_API_BASE_URL");
    }
  });

  it("preserves base URL query parameters and removes fragments", () => {
    assertEquals(
      getVeryfrontCloudGatewayBaseUrl(
        "https://api.veryfront.com/base/?region=eu#private-fragment",
        "openai",
      ),
      "https://api.veryfront.com/base/ai/gateway/openai/v1?region=eu",
    );
  });

  it("rejects unsafe gateway base URLs and unknown providers", () => {
    for (
      const baseURL of [
        "file:///tmp/gateway",
        "javascript:alert(1)",
        "not a URL",
        "https://user:private-password@api.veryfront.com",
      ]
    ) {
      assertThrows(
        () => getVeryfrontCloudGatewayBaseUrl(baseURL, "openai"),
        TypeError,
        "API base URL",
      );
    }
    assertThrows(
      () => getVeryfrontCloudGatewayBaseUrl("https://api.veryfront.com", "constructor" as never),
      TypeError,
      'Unsupported Veryfront Cloud provider "constructor"',
    );
  });

  it("rejects malformed gateway credentials before creating a fetch wrapper", () => {
    for (const token of ["", " token", "token ", "token\nprivate", "token-\u00e5"]) {
      assertThrows(
        () =>
          createVeryfrontCloudFetch(
            token,
            "https://93.184.216.34/ai/gateway/openai/v1",
          ),
        TypeError,
        "Veryfront Cloud API token",
      );
    }
  });

  it("rejects unsafe API base URLs before creating a fetch wrapper", () => {
    const cases = [
      ["", "non-empty valid HTTP(S) URL"],
      [" https://api.veryfront.com", "non-empty valid HTTP(S) URL"],
      ["not a URL", "valid HTTP(S) URL"],
      ["file:///tmp/gateway", "HTTP or HTTPS"],
      ["javascript:alert(1)", "HTTP or HTTPS"],
      [
        "https://user:private-password@api.veryfront.com/ai/gateway/openai/v1",
        "must not contain embedded credentials",
      ],
    ] as const;

    for (const [baseURL, expectedMessage] of cases) {
      assertThrows(
        () => createVeryfrontCloudFetch("vf_test_provider", baseURL),
        TypeError,
        expectedMessage,
      );
    }
  });

  it("rewrites auth headers for the gateway fetch wrapper", async () => {
    let capturedRequest: Request | undefined;

    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "https://93.184.216.34/ai/gateway/openai/v1",
    );

    await withMockFetch(
      async (input: URL | Request | string, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return new Response(null, { status: 204 });
      },
      () =>
        wrappedFetch("https://93.184.216.34/ai/gateway/openai/v1/chat/completions", {
          headers: {
            Authorization: "Bearer upstream-token",
            "x-api-key": "anthropic-key",
            "x-goog-api-key": "google-key",
            "x-veryfront-project-slug": "spoofed-project",
            "x-veryfront-billing-group-id": "spoofed-billing-group",
            "x-extra-header": "kept",
          },
        }),
    );

    assertEquals(capturedRequest?.headers.get("Authorization"), "Bearer vf_test_provider");
    assertEquals(capturedRequest?.headers.get("x-api-key"), null);
    assertEquals(capturedRequest?.headers.get("x-goog-api-key"), null);
    assertEquals(capturedRequest?.headers.get("x-extra-header"), "kept");
    assertEquals(capturedRequest?.headers.get("x-veryfront-project-slug"), null);
    assertEquals(capturedRequest?.headers.get("x-veryfront-billing-group-id"), null);
  });

  it("replaces caller identity headers with trusted project and billing context", async () => {
    let capturedRequest: Request | undefined;

    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "https://93.184.216.34/ai/gateway/openai/v1",
      "trusted-project",
    );

    await withMockFetch(
      async (input: URL | Request | string, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return new Response(null, { status: 204 });
      },
      () =>
        runWithVeryfrontCloudContext(
          { billingGroupId: "evalrun_20260628_kimi" },
          () =>
            wrappedFetch("https://93.184.216.34/ai/gateway/openai/v1/chat/completions", {
              headers: {
                "x-veryfront-project-slug": "spoofed-project",
                "x-veryfront-billing-group-id": "spoofed-billing-group",
              },
            }),
        ),
    );

    assertEquals(
      capturedRequest?.headers.get("x-veryfront-project-slug"),
      "trusted-project",
    );
    assertEquals(
      capturedRequest?.headers.get("x-veryfront-billing-group-id"),
      "evalrun_20260628_kimi",
    );
  });

  it("rejects redirects before the gateway credential reaches another origin", async () => {
    const seen: Request[] = [];
    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "https://93.184.216.34/ai/gateway/openai/v1",
    );

    await withMockFetch(
      async (input: URL | Request | string, init?: RequestInit) => {
        seen.push(new Request(input, init));
        return new Response(null, {
          status: 302,
          headers: { location: "https://93.184.216.35/steal" },
        });
      },
      () =>
        assertRejects(
          () => wrappedFetch("https://93.184.216.34/ai/gateway/openai/v1/chat/completions"),
          Error,
          "redirect",
        ),
    );
    assertEquals(seen.length, 1);
    assertEquals(seen[0]?.headers.get("authorization"), "Bearer vf_test_provider");
  });

  it("blocks a request to an origin other than the gateway base", async () => {
    const seen: Request[] = [];
    const wrappedFetch = createVeryfrontCloudFetch(
      "vf_test_provider",
      "https://93.184.216.34/ai/gateway/openai/v1",
    );

    await withMockFetch(
      async (input: URL | Request | string, init?: RequestInit) => {
        seen.push(new Request(input, init));
        return new Response(null, { status: 204 });
      },
      async () => {
        await assertRejects(
          () => wrappedFetch("https://93.184.216.35/v1/chat/completions"),
          Error,
          "not authorized",
          "a non-gateway origin must be rejected by the authorizeUrl guard",
        );
      },
    );
    assertEquals(
      seen.length,
      0,
      "the bearer credential must never leave the process for an unauthorized origin",
    );
  });
});
