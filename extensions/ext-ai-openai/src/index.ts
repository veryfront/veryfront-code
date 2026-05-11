/**
 * @veryfront/ext-ai-openai — registers the OpenAI provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-ai-openai
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/ai";
import { AIProviderRegistryName } from "veryfront/extensions/ai";
import { OpenAIProvider } from "./openai-provider.ts";

const extOpenAI: ExtensionFactory = () => {
  const provider = new OpenAIProvider();
  let registry: AIProviderRegistry | undefined;
  return {
    name: "ext-ai-openai",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:openai" }],
    setup(ctx) {
      registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-ai-openai] OpenAI provider registered");
    },
    teardown() {
      registry?.unregister(provider.id);
      registry = undefined;
    },
  };
};

export default extOpenAI;
export { OpenAIProvider };
