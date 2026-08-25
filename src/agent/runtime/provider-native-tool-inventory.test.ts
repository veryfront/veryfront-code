import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  createProviderNativeToolExposureDefinitions,
  expandAllowedRemoteToolNames,
  getForkRuntimeAllowedToolNames,
  getProviderNativeToolNames,
} from "./provider-native-tool-inventory.ts";

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

  it("returns OpenAI provider-native tool names for direct and hosted models", () => {
    assertEquals(getProviderNativeToolNames({ model: "openai/gpt-4.1" }), [
      "web_search",
    ]);
    assertEquals(
      getProviderNativeToolNames({ model: "veryfront-cloud/openai/gpt-4.1" }),
      ["web_search"],
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
