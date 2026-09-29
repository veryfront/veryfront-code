import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForScopeForTests,
  __setVeryfrontCloudCatalogForTests,
  withVeryfrontCloudCatalogScope,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  createProviderNativeToolExposureDefinitions,
  expandAllowedRemoteToolNames,
  getForkRuntimeAllowedToolNames,
  getProviderNativeToolNames,
} from "./provider-native-tool-inventory.ts";

function hostedCatalog(supportedProviderTools?: unknown) {
  return {
    models: [{
      id: "claude-sonnet-4-6",
      modelId: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      aliases: ["sonnet"],
      supportedProviderTools,
    }],
  };
}

const HOSTED_MODEL = "veryfront-cloud/anthropic/claude-sonnet-4-6";

describe("provider-native-tool-inventory", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  it("omits hosted tools until the served catalog declares support", () => {
    assertEquals(getProviderNativeToolNames({ model: HOSTED_MODEL }), []);
    for (const tools of [undefined, null, "web_search", [], [42]]) {
      __setVeryfrontCloudCatalogForTests(hostedCatalog(tools));
      assertEquals(getProviderNativeToolNames({ model: HOSTED_MODEL }), []);
    }
  });

  it("intersects the selected deployment's tools with implemented native tools", () => {
    __setVeryfrontCloudCatalogForTests(hostedCatalog(["web_search", "unknown", "web_search"]));
    assertEquals(getProviderNativeToolNames({ model: HOSTED_MODEL }), ["web_search"]);
    assertEquals(getProviderNativeToolNames({ model: "veryfront-cloud/anthropic/unlisted" }), []);
    // A provider hint must not bypass the hosted catalog.
    assertEquals(getProviderNativeToolNames({ model: HOSTED_MODEL, provider: "anthropic" }), [
      "web_search",
    ]);
  });

  it("changes tool exposure with the loaded deployment and keeps project scopes separate", () => {
    const scope = {
      apiBaseUrl: "https://api.veryfront.test",
      apiToken: "test-token",
      projectSlug: "allowed",
    };
    const denied = { ...scope, projectSlug: "denied" };
    __setVeryfrontCloudCatalogForScopeForTests(scope, hostedCatalog(["web_fetch"]));
    __setVeryfrontCloudCatalogForScopeForTests(denied, hostedCatalog([]));
    const names = () => getProviderNativeToolNames({ model: HOSTED_MODEL });
    assertEquals(withVeryfrontCloudCatalogScope(scope, names), ["web_fetch"]);
    assertEquals(withVeryfrontCloudCatalogScope(denied, names), []);
    __setVeryfrontCloudCatalogForScopeForTests(scope, hostedCatalog(["web_search"]));
    assertEquals(withVeryfrontCloudCatalogScope(scope, names), ["web_search"]);
    assertEquals(withVeryfrontCloudCatalogScope(denied, names), []);
    assertEquals(
      createProviderNativeToolExposureDefinitions({
        model: HOSTED_MODEL,
        toolNames: ["web_search"],
      }),
      [],
    );
  });
  it("returns anthropic provider-native tool names for an explicit provider", () => {
    assertEquals(getProviderNativeToolNames({ provider: "anthropic" }), [
      "web_fetch",
      "web_search",
    ]);
  });

  it("returns anthropic provider-native tool names from a direct anthropic model", () => {
    assertEquals(
      getProviderNativeToolNames({ model: "anthropic/claude-sonnet-4-6" }),
      ["web_fetch", "web_search"],
    );
  });

  it("returns served anthropic provider-native tool names from a veryfront-cloud anthropic model", () => {
    __setVeryfrontCloudCatalogForTests(hostedCatalog(["web_fetch", "web_search"]));
    assertEquals(
      getProviderNativeToolNames({
        model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      }),
      ["web_fetch", "web_search"],
    );
  });

  it("keeps direct OpenAI tools independent of missing hosted capabilities", () => {
    assertEquals(getProviderNativeToolNames({ model: "openai/gpt-4.1" }), [
      "web_search",
    ]);
    assertEquals(
      getProviderNativeToolNames({ model: "veryfront-cloud/openai/gpt-4.1" }),
      [],
    );
  });

  it("returns no provider-native tool names for unsupported providers", () => {
    assertEquals(getProviderNativeToolNames({ model: "google/gemini-3.5-flash" }), []);
  });

  it("creates deterministic schema-free search entries only for configured supported tools", () => {
    assertEquals(
      createProviderNativeToolExposureDefinitions({
        model: "anthropic/claude-sonnet-4-6",
        toolNames: ["web_search", "unknown", "web_fetch", "web_search"],
      }),
      [
        {
          name: "web_fetch",
          description: "Fetch and read the contents of a web page.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "web_search",
          description: "Search the web for current information.",
          parameters: { type: "object", properties: {} },
        },
      ],
    );
  });

  it("preserves a fork/runtime allowlist without adding undeclared provider-native tools", () => {
    assertEquals(
      expandAllowedRemoteToolNames({
        provider: "anthropic",
        toolNames: ["create_file", "web_search"],
      }),
      ["create_file", "web_search"],
    );
  });

  it("preserves the local allowlist when the provider has no provider-native tools", () => {
    assertEquals(
      expandAllowedRemoteToolNames({
        provider: "openai",
        toolNames: ["create_file"],
      }),
      ["create_file"],
    );
  });

  it("builds fork runtime allowed tool names from host tool definitions", () => {
    const forkTools: HostToolSet = {
      create_file: { description: "Create a file" },
      web_search: { description: "Search the web" },
    };

    assertEquals(
      getForkRuntimeAllowedToolNames({
        provider: "anthropic",
        forkModel: "claude-sonnet-4-6",
        forkTools,
      }),
      ["create_file", "web_search"],
    );
  });
});
