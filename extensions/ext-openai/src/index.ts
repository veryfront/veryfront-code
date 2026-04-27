/**
 * @veryfront/ext-openai — registers the OpenAI provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-openai
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { OpenAIProvider } from "./openai-provider.ts";

const extOpenAI: ExtensionFactory = () => {
  const provider = new OpenAIProvider();
  let registry: AIProviderRegistry | undefined;
  return {
    name: "ext-openai",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:openai" }],
    setup(ctx) {
      registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-openai] OpenAI provider registered");
    },
    teardown() {
      registry?.unregister(provider.id);
      registry = undefined;
    },
  };
};

export default extOpenAI;
export { OpenAIProvider };
