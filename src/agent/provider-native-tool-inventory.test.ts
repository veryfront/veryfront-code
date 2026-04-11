import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expandAllowedRemoteToolNames, getProviderNativeToolNames } from "./index.ts";

describe("provider-native-tool-inventory", () => {
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

  it("returns anthropic provider-native tool names from a veryfront-cloud anthropic model", () => {
    assertEquals(
      getProviderNativeToolNames({
        model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      }),
      ["web_fetch", "web_search"],
    );
  });

  it("returns no provider-native tool names for non-anthropic models", () => {
    assertEquals(getProviderNativeToolNames({ model: "openai/gpt-4o-mini" }), []);
  });

  it("expands a fork/runtime allowlist with provider-native tools", () => {
    assertEquals(
      expandAllowedRemoteToolNames({
        provider: "anthropic",
        toolNames: ["create_file", "web_search"],
      }),
      ["create_file", "web_fetch", "web_search"],
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
});
