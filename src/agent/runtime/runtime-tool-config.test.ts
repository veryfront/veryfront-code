import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import {
  getRuntimeAllowedRemoteTools,
  getRuntimeForwardedIntegrationToolDefs,
  getRuntimeProviderTools,
  getRuntimeSourceIntegrationPolicy,
  getRuntimeSourceIntegrationPolicyFromContext,
  resolveRuntimeToolExecutionContext,
} from "./runtime-tool-config.ts";

function runtimeConfig(extra: Record<string, unknown> = {}): AgentConfig {
  return {
    model: "auto",
    system: "Test runtime tool config.",
    ...extra,
  } as AgentConfig;
}

describe("agent/runtime-tool-config", () => {
  describe("resolveRuntimeToolExecutionContext", () => {
    it("resolves host-owned context at call time and preserves the default path", async () => {
      const abortSignal = new AbortController().signal;
      const originalContext = {
        authToken: "token-one",
        projectId: "project-one",
        projectSlug: "project-one",
        abortSignal,
        __vfSourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      };
      assertEquals(
        await resolveRuntimeToolExecutionContext(runtimeConfig(), originalContext),
        originalContext,
      );

      let liveIdentity = {
        authToken: "token-two",
        projectId: "project-two",
        projectSlug: "project-two",
      };
      const config = runtimeConfig({
        __vfResolveToolExecutionContext: async () => ({
          ...liveIdentity,
          abortSignal: "resolver-must-not-replace-this",
          __vfSourceIntegrationPolicy: "resolver-must-not-replace-this",
        }),
      });

      const second = await resolveRuntimeToolExecutionContext(config, originalContext);
      assertEquals(second.authToken, "token-two");
      assertEquals(second.projectId, "project-two");
      assertEquals(second.projectSlug, "project-two");
      assertEquals(second.abortSignal, abortSignal);
      assertEquals(second.__vfSourceIntegrationPolicy, {
        schemaVersion: 1,
        mode: "unrestricted",
      });

      liveIdentity = {
        authToken: "token-three",
        projectId: "project-three",
        projectSlug: "project-three",
      };
      const third = await resolveRuntimeToolExecutionContext(config, originalContext);
      assertEquals(third.authToken, "token-three");
      assertEquals(third.projectId, "project-three");
      assertEquals(third.projectSlug, "project-three");
    });

    it("clears an absent identity atomically but preserves explicit credential ownership", async () => {
      const originalContext = {
        authToken: "stale-token",
        projectId: "stale-project",
        projectSlug: "stale-project",
        runId: "run-one",
      };
      const absent = await resolveRuntimeToolExecutionContext(
        runtimeConfig({ __vfResolveToolExecutionContext: () => ({}) }),
        originalContext,
      );
      assertEquals(absent, { runId: "run-one" });

      const explicitlyInvalid = await resolveRuntimeToolExecutionContext(
        runtimeConfig({
          __vfResolveToolExecutionContext: () => ({ authToken: undefined }),
        }),
        originalContext,
      );
      assertEquals(Object.hasOwn(explicitlyInvalid, "authToken"), true);
      assertEquals(explicitlyInvalid.authToken, undefined);
      assertEquals(Object.hasOwn(explicitlyInvalid, "projectId"), false);
      assertEquals(Object.hasOwn(explicitlyInvalid, "projectSlug"), false);
    });
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
