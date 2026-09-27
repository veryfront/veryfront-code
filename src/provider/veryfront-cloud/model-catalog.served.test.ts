import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "./catalog-client.ts";
import {
  seedServedCatalogForTests,
  SERVED_MODEL_ROWS,
  servedCatalogPayload,
} from "./catalog-client.test-helpers.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
  isSupportedMistralModelId,
  resolveVeryfrontCloudDefaultModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAIChatSystemMessages,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudOpenAITransportPlan,
  resolveVeryfrontCloudProviderId,
  resolveVeryfrontCloudProviderRouting,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "./model-catalog.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID as TABLE_DEFAULT_MODEL_ID,
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES,
  VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES,
  VERYFRONT_CLOUD_PROVIDER_ALIASES,
  VERYFRONT_CLOUD_PROVIDER_ROUTING,
} from "./model-catalog.data.ts";
import { isOpenAIReasoningModel } from "../shared/openai-reasoning.ts";

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
    it("routes providers named after a protocol natively and any other on the default surface", () => {
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
    });

    it("declares no model facts and uses the built-in default model", () => {
      assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6"), undefined);
      assertEquals(resolveVeryfrontCloudOpenAITransport("openai/gpt-5.5"), undefined);
      assertEquals(
        resolveVeryfrontCloudOpenAIChatSystemMessages("mistral/mistral-small-2503"),
        undefined,
      );
      assertEquals(
        resolveVeryfrontCloudDefaultModelId(),
        DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
      );
      assertEquals(resolveVeryfrontCloudModelId(), DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID);
      // The platform refuses a model it does not serve; nothing is refused locally.
      assertEquals(isSupportedMistralModelId("mistral/not-served"), true);
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

  describe("parity with the shipped table for today's models", () => {
    const tableAliases = new Map<string, string>(VERYFRONT_CLOUD_PROVIDER_ALIASES);
    const tableKey = (modelId: string): string => {
      const slash = modelId.indexOf("/");
      const provider = modelId.slice(0, slash);
      return `${tableAliases.get(provider) ?? provider}/${modelId.slice(slash + 1)}`;
    };
    const tableRouting = new Map(VERYFRONT_CLOUD_PROVIDER_ROUTING);
    const tableCapabilities = new Map(VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES);
    const servedRows = SERVED_MODEL_ROWS as readonly ServedRow[];

    /** The transport plan the table-backed resolver chose, from the table's own inputs. */
    function tablePlan(provider: string, upstreamModelId: string, modelId: string) {
      const routing = tableRouting.get(provider);
      if (routing?.surface !== "openai" || routing.native !== true) {
        return { transport: "chat-completions", pinned: true };
      }
      const declared = tableCapabilities.get(tableKey(modelId))?.openAITransport;
      if (declared !== undefined) return { transport: declared, pinned: true };
      const entry = VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.find((model) =>
        tableKey(model.modelId) === tableKey(modelId)
      );
      if (entry?.thinking === true || entry?.thinkingBudgetTokens !== undefined) {
        return { transport: "responses", pinned: true };
      }
      if (isOpenAIReasoningModel(upstreamModelId, "veryfront-cloud")) {
        return { transport: "responses", pinned: true };
      }
      return { transport: "chat-completions", pinned: false };
    }

    it("covers every served row with a shipped table entry", () => {
      for (const served of servedRows) {
        const entry = VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.find((model) =>
          tableKey(model.modelId) === tableKey(served.modelId)
        );
        assertEquals(entry !== undefined, true, `${served.modelId} is not in the shipped table`);
      }
    });

    for (const served of servedRows) {
      const entry = VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.find((model) =>
        tableKey(model.modelId) === tableKey(served.modelId)
      );
      if (!entry) continue;

      it(`serves the shipped facts of ${entry.modelId}`, () => {
        __setVeryfrontCloudCatalogForTests(servedCatalogPayload());
        const key = tableKey(entry.modelId);
        const [provider = "", upstreamModelId = ""] = [
          key.slice(0, key.indexOf("/")),
          key.slice(key.indexOf("/") + 1),
        ];
        const capabilities = tableCapabilities.get(key);
        const routing = tableRouting.get(provider);

        assertEquals(resolveVeryfrontCloudProviderId(entry.modelId.split("/")[0] ?? ""), provider);
        assertEquals(resolveVeryfrontCloudProviderRouting(provider).surface, routing?.surface);
        assertEquals(
          resolveVeryfrontCloudProviderRouting(provider).native,
          routing?.native === true,
        );
        assertEquals(resolveVeryfrontCloudModelId(entry.id), entry.modelId);
        assertEquals(
          resolveVeryfrontCloudOpenAITransport(entry.modelId),
          capabilities?.openAITransport,
        );
        assertEquals(
          resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(entry.modelId),
          capabilities?.openAIChatReasoningWithFunctionTools,
        );
        assertEquals(
          resolveVeryfrontCloudOpenAIChatSystemMessages(entry.modelId),
          capabilities?.openAIChatPreserveSystemMessages,
        );
        if (routing?.surface === "openai") {
          assertEquals(
            resolveVeryfrontCloudOpenAITransportPlan(provider, upstreamModelId),
            tablePlan(provider, upstreamModelId, entry.modelId),
          );
        }

        const tableThinking = entry.thinking === true || entry.thinkingBudgetTokens !== undefined
          ? {
            enabled: true,
            ...(entry.thinkingBudgetTokens === undefined
              ? {}
              : { budgetTokens: entry.thinkingBudgetTokens }),
          }
          : undefined;
        const servedThinking = resolveVeryfrontCloudModelThinking(entry.modelId);
        if (capabilities?.anthropicThinkingMode === "adaptive") {
          // An adaptive model takes no budget, so the served catalog declares
          // none; what is sent is the same with or without the shipped one.
          assertEquals(servedThinking?.enabled, true);
          assertEquals(
            resolveVeryfrontCloudThinkingProviderOptions(entry.modelId, servedThinking),
            resolveVeryfrontCloudThinkingProviderOptions(entry.modelId, tableThinking),
          );
          assertEquals(
            resolveVeryfrontCloudReasoningOption(entry.modelId, servedThinking),
            resolveVeryfrontCloudReasoningOption(entry.modelId, tableThinking),
          );
        } else {
          assertEquals(servedThinking, tableThinking);
        }
      });
    }

    it("serves the shipped default model", () => {
      seedServedCatalogForTests();
      const tableDefault = VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.find((model) =>
        model.id === TABLE_DEFAULT_MODEL_ID
      );

      assertEquals(resolveVeryfrontCloudDefaultModelId(), tableDefault?.modelId);
      assertEquals(DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID, tableDefault?.modelId);
    });
  });
});
