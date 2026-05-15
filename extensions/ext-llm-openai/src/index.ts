/**
 * @veryfront/ext-llm-openai — registers the OpenAI provider into the
 * core `LLMProviderRegistry`.
 *
 * @module extensions/ext-llm-openai
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import { OpenAIProvider } from "./openai-provider.ts";

const extOpenAI: ExtensionFactory = () => {
  const provider = new OpenAIProvider();
  let registry: LLMProviderRegistry | undefined;
  return {
    name: "ext-llm-openai",
    version: "0.1.0",
    contracts: {
      provides: ["LLMProvider:openai"],
      requires: [LLMProviderRegistryName],
    },
    capabilities: [],
    setup(ctx) {
      registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-llm-openai] OpenAI provider registered");
    },
    teardown() {
      registry?.unregister(provider.id);
      registry = undefined;
    },
  };
};

export default extOpenAI;
export { OpenAIProvider };
