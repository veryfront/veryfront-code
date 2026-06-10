import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderTools,
} from "./runtime-tool-config.ts";

function runtimeConfig(extra: Record<string, unknown> = {}): AgentConfig {
  return {
    model: "auto",
    system: "Test runtime tool config.",
    ...extra,
  } as AgentConfig;
}

describe("agent/runtime-tool-config", () => {
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
