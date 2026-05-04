/**
 * @veryfront/ext-anthropic — registers the Anthropic provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-anthropic
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { AnthropicProvider } from "./anthropic-provider.ts";

const extAnthropic: ExtensionFactory = () => {
  const provider = new AnthropicProvider();
  let registryRef: AIProviderRegistry | undefined;
  return {
    name: "ext-anthropic",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:anthropic" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      registryRef = registry;
      ctx.logger.info("[ext-anthropic] Anthropic provider registered");
    },
    teardown() {
      registryRef?.unregister(provider.id);
      registryRef = undefined;
    },
  };
};

export default extAnthropic;
export { AnthropicProvider };
