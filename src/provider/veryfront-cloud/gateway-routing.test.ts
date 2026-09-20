import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders, resolveModel } from "#veryfront/provider";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { resolveGenAiProviderName } from "#veryfront/agent/hosted/trace-attributes.ts";
import { getProviderToolProfile } from "#veryfront/agent/runtime/provider-tool-compat.ts";
import { VERYFRONT_CLOUD_CHAT_MODELS } from "./model-catalog.ts";
import { getVeryfrontCloudGatewayBaseUrl, parseVeryfrontCloudModelId } from "./shared.ts";

const API_BASE_URL = "https://api.veryfront.com";
const CLOUD_ENV_KEYS = ["VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG"] as const;

/** Routing facts one catalog model resolves to today. */
type RoutingRow = {
  readonly model: string;
  readonly vendor: string;
  readonly gatewayBaseUrl: string;
  readonly genAiSystem: string | null;
  readonly toolProfile: string;
};

function routingRow(modelId: string): RoutingRow {
  const { provider } = parseVeryfrontCloudModelId(modelId, "language");
  return {
    model: modelId,
    vendor: provider,
    gatewayBaseUrl: getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, provider),
    genAiSystem: resolveGenAiProviderName(modelId),
    toolProfile: getProviderToolProfile(`veryfront-cloud/${modelId}`).provider,
  };
}

function setCloudBootstrap(): void {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_routing");
  setEnv("VERYFRONT_PROJECT_SLUG", "routing-test-project");
}

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

/**
 * Records the request URL a model builds without asserting on the response
 * body: the wire route is decided before any chunk is parsed, so an empty
 * stream is enough and keeps the fixture free of per-vendor payload shapes.
 */
async function captureRequestUrl(modelId: string): Promise<string | undefined> {
  let capturedUrl: string | undefined;
  installMockFetch(
    ((input: URL | Request | string, init?: RequestInit) => {
      capturedUrl ??= new Request(input, init).url;
      return Promise.resolve(
        new Response(new ReadableStream({ start: (controller) => controller.close() }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as typeof fetch,
  );

  const model = resolveModel(`veryfront-cloud/${modelId}`) as ModelRuntime;
  try {
    const result = await model.doStream({ prompt: [] } as never);
    const stream = (result as { stream?: ReadableStream<unknown> }).stream;
    if (stream) {
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // drain: the assertion targets the outgoing request, not the chunks
      }
      reader.releaseLock();
    }
  } catch {
    // expected: an empty gateway stream is not a valid provider response
  }
  return capturedUrl;
}

describe("provider/veryfront-cloud gateway routing", () => {
  afterEach(() => {
    restoreMockFetch();
    clearCloudEnv();
    clearModelProviders();
  });

  it("keeps the routing facts of every catalog model", () => {
    assertEquals(VERYFRONT_CLOUD_CHAT_MODELS.map((model) => routingRow(model.modelId)), [
      {
        model: "anthropic/claude-opus-4-8",
        vendor: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-opus-4-6",
        vendor: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-sonnet-4-6",
        vendor: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "anthropic/claude-haiku-4-5-20251001",
        vendor: "anthropic",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/anthropic/v1",
        genAiSystem: "anthropic",
        toolProfile: "anthropic",
      },
      {
        model: "openai/gpt-5.5",
        vendor: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4-mini",
        vendor: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4",
        vendor: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.4-nano",
        vendor: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "openai/gpt-5.2",
        vendor: "openai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/openai/v1",
        genAiSystem: "openai",
        toolProfile: "openai",
      },
      {
        model: "google-ai-studio/gemini-3.1-pro-preview",
        vendor: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-3.5-flash",
        vendor: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-2.5-pro",
        vendor: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "google-ai-studio/gemini-2.5-flash",
        vendor: "google",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/google/v1beta",
        genAiSystem: "gcp.gen_ai",
        toolProfile: "google",
      },
      {
        model: "mistral/mistral-large-2512",
        vendor: "mistral",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/mistral/v1",
        genAiSystem: null,
        toolProfile: "unknown",
      },
      {
        model: "moonshotai/kimi-k2.6",
        vendor: "moonshotai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/moonshotai/v1",
        genAiSystem: "moonshotai",
        toolProfile: "moonshot",
      },
      {
        model: "moonshotai/kimi-k2.5",
        vendor: "moonshotai",
        gatewayBaseUrl: "https://api.veryfront.com/ai/gateway/moonshotai/v1",
        genAiSystem: "moonshotai",
        toolProfile: "moonshot",
      },
    ]);
  });

  it("keeps the gateway base URL of every accepted vendor alias", () => {
    // Mistral is the one vendor whose model IDs are gated by the catalog, so
    // the alias is exercised with a listed model rather than a placeholder.
    const aliases: ReadonlyArray<readonly [string, string]> = [
      ["anthropic", "model-x"],
      ["openai", "model-x"],
      ["google", "model-x"],
      ["google-ai-studio", "model-x"],
      ["mistral", "mistral-large-2512"],
      ["moonshotai", "model-x"],
    ];

    assertEquals(
      aliases.map(([alias, modelId]) => {
        const { provider } = parseVeryfrontCloudModelId(`${alias}/${modelId}`, "language");
        return [alias, getVeryfrontCloudGatewayBaseUrl(API_BASE_URL, provider)];
      }),
      [
        ["anthropic", "https://api.veryfront.com/ai/gateway/anthropic/v1"],
        ["openai", "https://api.veryfront.com/ai/gateway/openai/v1"],
        ["google", "https://api.veryfront.com/ai/gateway/google/v1beta"],
        ["google-ai-studio", "https://api.veryfront.com/ai/gateway/google/v1beta"],
        ["mistral", "https://api.veryfront.com/ai/gateway/mistral/v1"],
        ["moonshotai", "https://api.veryfront.com/ai/gateway/moonshotai/v1"],
      ],
    );
  });

  it("keeps the wire route and provider attribute of one model per vendor", async () => {
    setCloudBootstrap();

    const routes: Array<[string, string | undefined, unknown]> = [];
    for (
      const modelId of [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.5",
        "openai/gpt-5.4-nano",
        "google-ai-studio/gemini-3.5-flash",
        "mistral/mistral-large-2512",
        "moonshotai/kimi-k2.6",
      ]
    ) {
      const url = await captureRequestUrl(modelId);
      const model = resolveModel(`veryfront-cloud/${modelId}`) as unknown as {
        modelProvider?: unknown;
      };
      routes.push([modelId, url, model.modelProvider]);
      restoreMockFetch();
    }

    assertEquals(routes, [
      [
        "anthropic/claude-sonnet-4-6",
        "https://api.veryfront.com/ai/gateway/anthropic/v1/messages",
        "anthropic",
      ],
      [
        "openai/gpt-5.5",
        "https://api.veryfront.com/ai/gateway/openai/v1/chat/completions",
        "openai",
      ],
      [
        "openai/gpt-5.4-nano",
        "https://api.veryfront.com/ai/gateway/openai/v1/responses",
        "openai",
      ],
      [
        "google-ai-studio/gemini-3.5-flash",
        "https://api.veryfront.com/ai/gateway/google/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
        "google",
      ],
      [
        "mistral/mistral-large-2512",
        "https://api.veryfront.com/ai/gateway/mistral/v1/chat/completions",
        "mistral",
      ],
      [
        "moonshotai/kimi-k2.6",
        "https://api.veryfront.com/ai/gateway/moonshotai/v1/chat/completions",
        "moonshotai",
      ],
    ]);
  });
});
