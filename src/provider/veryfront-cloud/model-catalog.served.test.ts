import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForScopeForTests,
  __setVeryfrontCloudCatalogForTests,
  forgetReceivedVeryfrontCloudCatalog,
  isVeryfrontCloudCatalogFresh,
  peekVeryfrontCloudCatalog,
  rememberReceivedVeryfrontCloudCatalog,
  veryfrontCloudCatalogScopeKey,
  withVeryfrontCloudCatalogScope,
} from "./catalog-client.ts";
import { runWithVeryfrontCloudContext } from "./context.ts";
import {
  seedServedCatalogForTests,
  SERVED_MODEL_ROWS,
  UNSERVED_MODEL_ROWS,
} from "./catalog-client.test-helpers.ts";
import {
  canVeryfrontCloudCatalogRefuse,
  DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
  isRetiredVeryfrontCloudModelId,
  isSupportedMistralModelId,
  readServedVeryfrontCloudCatalogModel,
  resolveVeryfrontCloudDefaultModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAIChatSystemMessages,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudOpenAITransportPlan,
  resolveVeryfrontCloudProviderId,
  resolveVeryfrontCloudProviderRouting,
} from "./model-catalog.ts";
import { resolveVeryfrontCloudGatewayRoute } from "./shared.ts";
import { VeryfrontError } from "#veryfront/errors";

type ServedRow = {
  id: string;
  modelId: string;
  provider: string;
  surface?: string;
  operations?: readonly string[];
  aliases: readonly string[];
  capabilities: Record<string, unknown>;
};

/** A served payload of the given rows, each with the fields a row always carries. */
function payload(rows: readonly ServedRow[], defaultModelId?: string): Record<string, unknown> {
  return { models: rows, ...(defaultModelId ? { defaultModelId } : {}) };
}

function row(modelId: string, fields: Partial<ServedRow> = {}): ServedRow {
  const [provider = "", id = ""] = modelId.split("/");
  return { id, modelId, provider, aliases: [], capabilities: {}, ...fields };
}

describe("provider/veryfront-cloud/model-catalog served facts", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  describe("before the catalog is loaded", () => {
    it("routes on protocol defaults: protocol providers natively, others on the OpenAI protocol", () => {
      assertEquals(resolveVeryfrontCloudProviderRouting("openai"), {
        surface: "openai",
        native: true,
      });
      assertEquals(resolveVeryfrontCloudProviderRouting("anthropic"), {
        surface: "anthropic",
        native: true,
      });
      assertEquals(resolveVeryfrontCloudProviderRouting("google"), {
        surface: "google",
        native: true,
      });
      assertEquals(resolveVeryfrontCloudProviderRouting("mistral"), { surface: "openai" });
      assertEquals(resolveVeryfrontCloudProviderRouting("acme-labs"), { surface: "openai" });
    });

    it("routes google-ai-studio as Google", () => {
      assertEquals(resolveVeryfrontCloudProviderId("google-ai-studio"), "google");
      assertEquals(resolveVeryfrontCloudProviderRouting("google-ai-studio"), {
        surface: "google",
        native: true,
      });
    });

    it("knows no model facts and refuses no model", () => {
      assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6"), undefined);
      assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.5"), undefined);
      assertEquals(
        resolveVeryfrontCloudOpenAIChatSystemMessages("mistral/mistral-small-2503"),
        undefined,
      );
      assertThrows(() => resolveVeryfrontCloudModelId("opus"), Error, "Unknown model alias");
      assertEquals(
        resolveVeryfrontCloudDefaultModelId(),
        DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
      );
      assertEquals(resolveVeryfrontCloudModelId(), DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID);
      assertEquals(canVeryfrontCloudCatalogRefuse(), false);
      assertEquals(resolveVeryfrontCloudModelId("mistral/not-listed"), "mistral/not-listed");
    });
  });

  describe("scope", () => {
    const projectA = {
      apiBaseUrl: "https://api.example.test",
      apiToken: "token-a",
      projectSlug: "a",
    };
    const projectB = {
      apiBaseUrl: "https://api.example.test",
      apiToken: "token-b",
      projectSlug: "b",
    };
    const sameProjectOtherToken = { ...projectA, apiToken: "token-c" };

    it("reads each project's own catalog, never one another project loaded", () => {
      __setVeryfrontCloudCatalogForScopeForTests(
        projectA,
        payload([
          row("openai/gpt-a", { surface: "openai", operations: ["chat-completions"] }),
        ], "openai/gpt-a"),
      );
      __setVeryfrontCloudCatalogForScopeForTests(
        projectB,
        payload([
          row("mistral/mistral-b", { surface: "openai", operations: ["chat-completions"] }),
        ], "mistral/mistral-b"),
      );

      withVeryfrontCloudCatalogScope(projectA, () => {
        assertEquals(isSupportedMistralModelId("mistral/mistral-b"), false);
        assertEquals(resolveVeryfrontCloudDefaultModelId(), "openai/gpt-a");
        assertEquals(resolveVeryfrontCloudProviderRouting("openai").native, false);
      });
      withVeryfrontCloudCatalogScope(projectB, () => {
        assertEquals(isSupportedMistralModelId("mistral/mistral-b"), true);
        assertEquals(resolveVeryfrontCloudDefaultModelId(), "mistral/mistral-b");
      });
    });

    it("keeps a credential's catalog apart from another credential's for the same project", () => {
      __setVeryfrontCloudCatalogForScopeForTests(projectA, payload([], "openai/gpt-a"));

      assertEquals(peekVeryfrontCloudCatalog(projectA)?.defaultModelId, "openai/gpt-a");
      assertEquals(peekVeryfrontCloudCatalog(sameProjectOtherToken), undefined);
      withVeryfrontCloudCatalogScope(sameProjectOtherToken, () => {
        // Nothing loaded for this credential: protocol defaults apply.
        assertEquals(
          resolveVeryfrontCloudDefaultModelId(),
          DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
        );
        assertThrows(() => resolveVeryfrontCloudModelId("opus"), Error, "Unknown model alias");
      });
    });

    it("reads a received catalog under its key until it is forgotten", () => {
      const key = rememberReceivedVeryfrontCloudCatalog([{
        id: "claude-sonnet-4-6",
        modelId: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        aliases: [],
        surface: "anthropic",
        thinking: true,
        reasoningBudgetTokens: 1024,
      }]);
      const read = () =>
        runWithVeryfrontCloudContext(
          { catalogScopeKey: key },
          () => resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6"),
        );
      assertEquals(read(), { enabled: true, budgetTokens: 1024 });
      // It lists only the models it was received for, so it never refuses one.
      assertEquals(isVeryfrontCloudCatalogFresh(key), false);
      forgetReceivedVeryfrontCloudCatalog(key);
      assertEquals(read(), undefined);
    });

    it("reads a served row for a scope key only once one has loaded", () => {
      const key = veryfrontCloudCatalogScopeKey(projectA);
      assertEquals(
        readServedVeryfrontCloudCatalogModel(key, "anthropic/claude-sonnet-4-6"),
        undefined,
      );
      __setVeryfrontCloudCatalogForScopeForTests(
        projectA,
        payload([row("anthropic/claude-sonnet-4-6", { surface: "anthropic" })]),
      );
      assertEquals(
        readServedVeryfrontCloudCatalogModel(key, "veryfront-cloud/anthropic/claude-sonnet-4-6")
          ?.modelId,
        "anthropic/claude-sonnet-4-6",
      );
      assertEquals(readServedVeryfrontCloudCatalogModel(key, "anthropic/unlisted"), undefined);
    });

    it("keeps google-ai-studio as Google when a loaded catalog lists no Google model", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("openai/gpt-x", { surface: "openai", operations: ["chat-completions"] }),
      ]));

      assertEquals(resolveVeryfrontCloudProviderId("google-ai-studio"), "google");
      assertEquals(resolveVeryfrontCloudProviderRouting("google-ai-studio").surface, "google");
    });
  });

  describe("once the catalog is loaded", () => {
    it("reads native providers from the operations each model is served on", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("openai/gpt-chat-only", { surface: "openai", operations: ["chat-completions"] }),
        row("acme/acme-1", { surface: "openai", operations: ["responses", "chat-completions"] }),
        row("anthropic/claude-x", { surface: "anthropic", operations: ["messages"] }),
      ]));

      assertEquals(resolveVeryfrontCloudProviderRouting("openai"), {
        surface: "openai",
        native: false,
      });
      assertEquals(resolveVeryfrontCloudProviderRouting("acme"), {
        surface: "openai",
        native: true,
      });
      assertEquals(resolveVeryfrontCloudProviderRouting("anthropic"), {
        surface: "anthropic",
        native: true,
      });
    });

    it("keeps a model the platform does not serve on Responses on chat completions", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("openai/gpt-5.9", {
          surface: "openai",
          operations: ["responses", "chat-completions"],
          capabilities: { thinking: true },
        }),
        row("openai/gpt-5.9-chat", {
          surface: "openai",
          operations: ["chat-completions"],
          capabilities: { thinking: true },
        }),
      ]));

      assertEquals(resolveVeryfrontCloudOpenAITransportPlan("openai", "gpt-5.9"), {
        transport: "responses",
        pinned: true,
      });
      assertEquals(resolveVeryfrontCloudOpenAITransportPlan("openai", "gpt-5.9-chat"), {
        transport: "chat-completions",
        pinned: true,
      });
    });

    it("reads the thinking budget from reasoning_budget_tokens", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("anthropic/claude-sonnet-4-6", {
          surface: "anthropic",
          aliases: ["sonnet"],
          capabilities: { thinking: true, reasoning_mode: "budget", reasoning_budget_tokens: 4096 },
        }),
        row("openai/gpt-think", { surface: "openai", capabilities: { thinking: true } }),
        row("openai/gpt-plain", { surface: "openai", capabilities: { thinking: false } }),
      ]));

      assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6"), {
        enabled: true,
        budgetTokens: 4096,
      });
      assertEquals(resolveVeryfrontCloudModelThinking("sonnet"), {
        enabled: true,
        budgetTokens: 4096,
      });
      assertEquals(resolveVeryfrontCloudModelThinking("openai/gpt-think"), { enabled: true });
      assertEquals(resolveVeryfrontCloudModelThinking("openai/gpt-plain"), undefined);
    });

    it("reads both chat completions flags from their capability fields", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("openai/gpt-5.4", {
          surface: "openai",
          capabilities: {
            transport: "chat-completions",
            chat_completions_reasoning_with_function_tools: true,
          },
        }),
        row("mistral/mistral-small-2503", {
          surface: "openai",
          capabilities: { chat_completions_consecutive_system_messages: false },
        }),
      ]));

      assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.4"), "chat-completions");
      assertEquals(resolveVeryfrontCloudOpenAIChatFunctionToolReasoning("openai/gpt-5.4"), true);
      assertEquals(
        resolveVeryfrontCloudOpenAIChatSystemMessages("mistral/mistral-small-2503"),
        false,
      );
    });

    it("resolves a provider alias from the served provider field", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("vendor-studio/vendor-model", { provider: "vendor", surface: "google" }),
      ]));

      assertEquals(resolveVeryfrontCloudProviderId("vendor-studio"), "vendor");
      assertEquals(resolveVeryfrontCloudProviderRouting("vendor-studio").surface, "google");
    });

    it("refuses a non-Google provider on the Google surface instead of reaching a retired route", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("vendor-studio/vendor-model", { provider: "vendor", surface: "google" }),
      ]));

      const error = assertThrows(
        () => resolveVeryfrontCloudGatewayRoute("https://api.veryfront.com", "vendor-studio"),
        VeryfrontError,
        'Veryfront Cloud provider "vendor" speaks the google protocol',
      );
      assertEquals((error as VeryfrontError).slug, "not-supported");
      assertEquals(
        resolveVeryfrontCloudGatewayRoute("https://api.veryfront.com", "google"),
        { baseURL: "https://api.veryfront.com/ai/v1beta", neutral: true },
      );
    });

    it("refuses a served provider on a future wire surface without a vendor-route fallback", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("future-labs/future-model", { surface: "a-later-wire-format" }),
      ]));

      const error = assertThrows(
        () => resolveVeryfrontCloudGatewayRoute("https://api.veryfront.com", "future-labs"),
        VeryfrontError,
        'Veryfront Cloud wire surface "a-later-wire-format" is not supported',
      );
      assertEquals((error as VeryfrontError).slug, "not-supported");
    });

    it("uses the default model the catalog names", () => {
      __setVeryfrontCloudCatalogForTests(
        payload([row("anthropic/claude-sonnet-4-6")], "anthropic/claude-sonnet-4-6"),
      );

      assertEquals(resolveVeryfrontCloudDefaultModelId(), "anthropic/claude-sonnet-4-6");
      assertEquals(resolveVeryfrontCloudModelId(), "anthropic/claude-sonnet-4-6");
    });

    it("refuses a Mistral model the catalog does not list", () => {
      seedServedCatalogForTests();

      assertEquals(isSupportedMistralModelId("mistral/mistral-small-2503"), true);
      assertEquals(isSupportedMistralModelId("mistral/not-served"), false);
    });
  });

  describe("retired models", () => {
    const retired = [
      "openai/gpt-5.4-nano",
      "mistral/mistral-large-2512",
      "google-ai-studio/gemini-3.1-pro-preview",
      "google/gemini-3.1-pro-preview",
    ];

    it("refuses a retired model through Veryfront Cloud before the catalog loads", () => {
      for (const modelId of retired) {
        assertEquals(isRetiredVeryfrontCloudModelId(modelId), true, modelId);
        assertEquals(isRetiredVeryfrontCloudModelId(`veryfront-cloud/${modelId}`), true, modelId);
        // Mistral ids the list does not carry keep the Mistral refusal first.
        assertThrows(() => resolveVeryfrontCloudModelId(modelId), Error);
      }
      assertThrows(
        () => resolveVeryfrontCloudModelId("openai/gpt-5.4-nano"),
        Error,
        "no longer available",
      );
    });

    it("refuses a retired model even when a loaded catalog still lists it", () => {
      __setVeryfrontCloudCatalogForTests(payload([
        row("openai/gpt-5.4-nano", { surface: "openai", operations: ["chat-completions"] }),
      ]));

      assertThrows(
        () => resolveVeryfrontCloudModelId("openai/gpt-5.4-nano"),
        Error,
        "no longer available",
      );
    });

    it("keeps retired models out of the served fixtures", () => {
      const fixtureIds: string[] = [...SERVED_MODEL_ROWS, ...UNSERVED_MODEL_ROWS].map((
        model,
      ) => model.modelId);
      for (const modelId of retired) {
        assertEquals(fixtureIds.includes(modelId), false, modelId);
      }
      assertThrows(
        () => resolveVeryfrontCloudModelId("gpt-5.4-nano"),
        Error,
        "Unknown model alias",
      );
    });
  });

  it("serves the built-in default model", () => {
    seedServedCatalogForTests();
    assertEquals(resolveVeryfrontCloudDefaultModelId(), DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID);
  });
});
