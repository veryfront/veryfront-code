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
  return {
    name: "ext-anthropic",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:anthropic" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-anthropic] Anthropic provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extAnthropic;
export { AnthropicProvider };
