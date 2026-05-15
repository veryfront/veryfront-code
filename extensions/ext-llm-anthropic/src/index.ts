/**
 * @veryfront/ext-llm-anthropic — registers the Anthropic provider into the
 * core `LLMProviderRegistry`.
 *
 * @module extensions/ext-llm-anthropic
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import { AnthropicProvider } from "./anthropic-provider.ts";

const extAnthropic: ExtensionFactory = () => {
  const provider = new AnthropicProvider();
  let registryRef: LLMProviderRegistry | undefined;
  return {
    name: "ext-llm-anthropic",
    version: "0.1.0",
    contracts: {
      provides: ["LLMProvider:anthropic"],
      requires: [LLMProviderRegistryName],
    },
    capabilities: [],
    setup(ctx) {
      const registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registry.register(provider);
      registryRef = registry;
      ctx.logger.info("[ext-llm-anthropic] Anthropic provider registered");
    },
    teardown() {
      registryRef?.unregister(provider.id);
      registryRef = undefined;
    },
  };
};

export default extAnthropic;
export { AnthropicProvider };
