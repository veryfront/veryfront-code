import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import { AgentRuntime } from "./index.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
  getRuntimeSourceIntegrationPolicyFromContext,
  getRuntimeToolExposureCheckpoint,
  getRuntimeToolSearchAuthorization,
  resolveRuntimeNativeToolSearch,
  resolveRuntimeToolLoading,
} from "./runtime-tool-config.ts";

function runtimeConfig(extra: Record<string, unknown> = {}): AgentConfig {
  return {
    model: "auto",
    system: "Test runtime tool config.",
    ...extra,
  } as AgentConfig;
}

describe("agent/runtime-tool-config", () => {
  it("resolves tool loading with host override ahead of eval override and records provenance", () => {
    assertEquals(resolveRuntimeToolLoading(runtimeConfig({ toolLoading: "deferred" })), {
      mode: "deferred",
      provenance: "agent-config",
    });
    assertEquals(
      resolveRuntimeToolLoading(runtimeConfig({ toolLoading: "deferred" }), "eager"),
      {
        mode: "eager",
        provenance: "eval-override",
      },
    );
    assertEquals(
      resolveRuntimeToolLoading(
        runtimeConfig({
          toolLoading: "eager",
          __vfOperationalToolLoadingOverride: "deferred",
        }),
        "eager",
      ),
      {
        mode: "deferred",
        provenance: "host-operational-override",
      },
    );
  });

  it("rejects invalid agent-config tool loading modes", () => {
    for (const toolLoading of ["auto", "defered", "unknown"]) {
      assertThrows(
        () => resolveRuntimeToolLoading(runtimeConfig({ toolLoading })),
        Error,
        "toolLoading",
      );
      assertThrows(
        () => new AgentRuntime("invalid-tool-loading", runtimeConfig({ toolLoading })),
        Error,
        "toolLoading",
      );
    }
  });

  it("defaults trusted authoring search authorization closed", () => {
    assertEquals(
      getRuntimeToolSearchAuthorization(runtimeConfig({
        context: {
          canConfigureAgentTools: true,
          attachableCatalog: [{ name: "list_agents" }],
        },
      })),
      { canConfigureAgentTools: false, attachableCatalog: [] },
    );
  });

  describe("resolveRuntimeNativeToolSearch", () => {
    const authorization = {
      canConfigureAgentTools: false,
      attachableCatalog: [],
    };

    it("defaults provider-native search off and retains framework fallback", () => {
      assertEquals(
        resolveRuntimeNativeToolSearch(
          runtimeConfig({ toolLoading: "deferred" }),
          "anthropic/claude-sonnet-4-5",
          authorization,
        ),
        undefined,
      );
    });

    it("enables Anthropic native search through trusted internal config", () => {
      assertEquals(
        resolveRuntimeNativeToolSearch(
          runtimeConfig({ __vfNativeProviderToolSearchEnabled: true }),
          "anthropic/claude-sonnet-4-5",
          authorization,
        ),
        { mode: "hosted", variant: "regex" },
      );
    });

    it("enables OpenAI native search through trusted internal config", () => {
      assertEquals(
        resolveRuntimeNativeToolSearch(
          runtimeConfig({ __vfNativeProviderToolSearchEnabled: true }),
          "openai/gpt-5.4",
          authorization,
        ),
        { mode: "hosted" },
      );
    });

    it("uses framework fallback when trusted internal config explicitly disables native search", () => {
      assertEquals(
        resolveRuntimeNativeToolSearch(
          runtimeConfig({ __vfNativeProviderToolSearchEnabled: false }),
          "openai/gpt-5.4",
          authorization,
        ),
        undefined,
      );
    });
  });

  it("accepts only supported private checkpoint state from internal config", () => {
    assertEquals(
      getRuntimeToolExposureCheckpoint(runtimeConfig({
        __vfToolExposureCheckpoint: {
          version: 1,
          authorizedCatalogFingerprint: "v1-catalog",
          loadedToolNames: ["get_release"],
        },
      })),
      {
        version: 1,
        authorizedCatalogFingerprint: "v1-catalog",
        loadedToolNames: ["get_release"],
      },
    );
    assertEquals(
      getRuntimeToolExposureCheckpoint(runtimeConfig({
        __vfToolExposureCheckpoint: {
          version: 2,
          loadedToolNames: ["get_release"],
        },
      })),
      undefined,
    );
  });

  describe("getRuntimeAllowedRemoteTools", () => {
    it("distinguishes absent allow-lists from invalid configured allow-lists", () => {
      assertEquals(getRuntimeAllowedRemoteTools(runtimeConfig()), undefined);
      assertEquals(
        getRuntimeAllowedRemoteTools(runtimeConfig({
          __vfAllowedRemoteTools: "search",
        })),
        [],
      );
    });

    it("preserves valid remote tool allow-lists and fails closed for mixed arrays", () => {
      assertEquals(
        getRuntimeAllowedRemoteTools(runtimeConfig({
          __vfAllowedRemoteTools: ["search_docs", "read_file"],
        })),
        ["search_docs", "read_file"],
      );
      assertEquals(
        getRuntimeAllowedRemoteTools(runtimeConfig({
          __vfAllowedRemoteTools: ["search_docs", 42],
        })),
        [],
      );
    });
  });

  describe("getRuntimeSourceIntegrationPolicy", () => {
    it("preserves a valid manifest and fails malformed internal state closed", () => {
      const policy = {
        schemaVersion: 1 as const,
        mode: "allowlist" as const,
        integrations: { gmail: { allowedToolIds: ["list_emails"] } },
      };

      assertEquals(
        getRuntimeSourceIntegrationPolicy(runtimeConfig({
          __vfSourceIntegrationPolicy: policy,
        })),
        policy,
      );
      assertEquals(
        getRuntimeSourceIntegrationPolicy(runtimeConfig({
          __vfSourceIntegrationPolicy: {
            schemaVersion: 1,
            mode: "allowlist",
            integrations: { gmail: { allowedToolIds: "list_emails" } },
          },
        })),
        { schemaVersion: 1, mode: "allowlist", integrations: {} },
      );
    });

    it("reads the same fail-closed manifest contract from child tool context", () => {
      assertEquals(getRuntimeSourceIntegrationPolicyFromContext(undefined), undefined);
      assertEquals(
        getRuntimeSourceIntegrationPolicyFromContext({
          __vfSourceIntegrationPolicy: { schemaVersion: 2, mode: "unrestricted" },
        }),
        { schemaVersion: 1, mode: "allowlist", integrations: {} },
      );
    });
  });

  describe("getRuntimeProviderTools", () => {
    it("returns provider-native tool names only when the whole list is valid", () => {
      assertEquals(getRuntimeProviderTools(runtimeConfig()), []);
      assertEquals(
        getRuntimeProviderTools(runtimeConfig({
          providerTools: ["web_search", "web_fetch"],
        })),
        ["web_search", "web_fetch"],
      );
      assertEquals(
        getRuntimeProviderTools(runtimeConfig({
          providerTools: ["web_search", 42],
        })),
        [],
      );
    });
  });

  describe("getRuntimeForwardedIntegrationToolDefs", () => {
    it("normalizes forwarded integration definitions and filters malformed entries", () => {
      assertEquals(
        getRuntimeForwardedIntegrationToolDefs(runtimeConfig({
          __vfForwardedIntegrationToolDefs: [
            {
              name: "search_docs",
              description: "Search docs",
              parameters: { type: "object", properties: { query: { type: "string" } } },
            },
            {
              name: "bad_params",
              description: "Bad params",
              parameters: ["not", "an", "object"],
            },
            {
              name: 42,
              description: "Bad name",
              parameters: { type: "object" },
            },
          ],
        })),
        [
          {
            name: "search_docs",
            description: "Search docs",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          },
          {
            name: "bad_params",
            description: "Bad params",
            parameters: { type: "object", properties: {} },
          },
        ],
      );
    });

    it("returns undefined when no forwarded definitions are present", () => {
      assertEquals(getRuntimeForwardedIntegrationToolDefs(runtimeConfig()), undefined);
      assertEquals(
        getRuntimeForwardedIntegrationToolDefs(runtimeConfig({
          __vfForwardedIntegrationToolDefs: [],
        })),
        undefined,
      );
    });
  });
});
