import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { registerVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  resolveActiveProviderReplayProvider,
  resolveRuntimeGenAiProviderName,
} from "./provider-replay-protocol.ts";

function model(modelProvider: string, surface?: string): ModelRuntime {
  const runtime: ModelRuntime = {
    provider: "veryfront-cloud",
    modelProvider,
    modelId: "m1",
    doGenerate: () => Promise.reject(new Error("not called")),
    doStream: () => Promise.reject(new Error("not called")),
  };
  if (surface !== undefined) {
    registerVeryfrontCloudModelFacts(runtime, () =>
      ({
        provider: modelProvider,
        surface,
        native: false,
        transportPlan: "chat-completions",
      }) as never);
  }
  return runtime;
}

describe("resolveActiveProviderReplayProvider", () => {
  it("replays the named protocol providers as before", () => {
    assertEquals(resolveActiveProviderReplayProvider(model("anthropic")), "anthropic");
    assertEquals(resolveActiveProviderReplayProvider(model("openai")), "openai-responses");
  });

  it("replays a provider served on the Anthropic surface like anthropic/*", () => {
    assertEquals(resolveActiveProviderReplayProvider(model("acme-labs", "anthropic")), "anthropic");
  });

  it("does not replay a provider on another surface, or one with no served facts", () => {
    assertEquals(resolveActiveProviderReplayProvider(model("acme-labs", "openai")), "unsupported");
    assertEquals(resolveActiveProviderReplayProvider(model("acme-labs")), "unsupported");
  });
});

describe("resolveRuntimeGenAiProviderName", () => {
  it("names the GenAI provider of a runtime model id", () => {
    assertEquals(resolveRuntimeGenAiProviderName("veryfront-cloud/anthropic/claude"), "anthropic");
    assertEquals(resolveRuntimeGenAiProviderName("google-ai-studio/gemini"), "gcp.gen_ai");
    assertEquals(resolveRuntimeGenAiProviderName("acme-labs/m1"), undefined);
  });
});
