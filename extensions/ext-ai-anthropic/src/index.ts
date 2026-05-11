/**
 * @veryfront/ext-ai-anthropic — registers the Anthropic provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-ai-anthropic
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/ai";
import { AIProviderRegistryName } from "veryfront/extensions/ai";
import { AnthropicProvider } from "./anthropic-provider.ts";

const extAnthropic: ExtensionFactory = () => {
  const provider = new AnthropicProvider();
  let registryRef: AIProviderRegistry | undefined;
  return {
    name: "ext-ai-anthropic",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:anthropic" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      registryRef = registry;
      ctx.logger.info("[ext-ai-anthropic] Anthropic provider registered");
    },
    teardown() {
      registryRef?.unregister(provider.id);
      registryRef = undefined;
    },
  };
};

export default extAnthropic;
export { AnthropicProvider };
