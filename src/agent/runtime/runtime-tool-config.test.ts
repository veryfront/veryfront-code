import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import type { ProviderReplayCheckpoint } from "./provider-replay.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderReplayCheckpoints,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
  getRuntimeSourceIntegrationPolicyFromContext,
  getRuntimeToolExposureCheckpoint,
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
  it("derives tool loading from the public tools selector", () => {
    assertEquals(resolveRuntimeToolLoading(runtimeConfig()), {
      mode: "eager",
      provenance: "tools-selector",
    });
    assertEquals(resolveRuntimeToolLoading(runtimeConfig({ tools: true })), {
      mode: "deferred",
      provenance: "tools-selector",
    });
    assertEquals(resolveRuntimeToolLoading(runtimeConfig({ tools: { get_release: true } })), {
      mode: "eager",
      provenance: "tools-selector",
    });
  });

  it("keeps host bindings internal and gives the eager rollback override precedence", () => {
    assertEquals(
      resolveRuntimeToolLoading(runtimeConfig({
        tools: true,
        __vfToolLoadingMode: "eager",
      })),
      {
        mode: "eager",
        provenance: "host-runtime-binding",
      },
    );
    assertEquals(
      resolveRuntimeToolLoading(runtimeConfig({
        tools: true,
        __vfToolLoadingMode: "deferred",
        __vfOperationalToolLoadingOverride: "eager",
      })),
      {
        mode: "eager",
        provenance: "host-operational-override",
      },
    );
  });

  it("accepts only supported private checkpoint state from internal config", () => {
    assertEquals(
      getRuntimeToolExposureCheckpoint(runtimeConfig({
        __vfToolExposureCheckpoint: {
          version: 1,
          loadedToolNames: ["get_release"],
        },
      })),
      {
        version: 1,
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
      {
        version: 2,
        loadedToolNames: ["get_release"],
      },
    );
    assertEquals(
      getRuntimeToolExposureCheckpoint(runtimeConfig({
        __vfToolExposureCheckpoint: {
          version: 3,
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

  describe("getRuntimeProviderReplayCheckpoints", () => {
    it("returns undefined when the trusted host resolved no replay state", () => {
      assertEquals(getRuntimeProviderReplayCheckpoints(runtimeConfig()), undefined);
    });

    it("returns the checkpoints resolved by the trusted host", () => {
      const checkpoint: ProviderReplayCheckpoint = {
        version: 1,
        messageId: "assistant-message-1",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "thinking", thinking: "", signature: "sig-config" },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      };
      assertEquals(
        getRuntimeProviderReplayCheckpoints(runtimeConfig({
          __vfProviderReplayCheckpoints: [checkpoint],
        })),
        [checkpoint],
      );
    });

    it("passes host-resolved state through without re-parsing it", () => {
      assertEquals(
        getRuntimeProviderReplayCheckpoints(runtimeConfig({
          __vfProviderReplayCheckpoints: [{ version: 1 }],
        })),
        [{ version: 1 }] as unknown as readonly ProviderReplayCheckpoint[],
      );
    });
  });
});
