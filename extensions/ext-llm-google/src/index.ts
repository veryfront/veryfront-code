/**
 * @veryfront/ext-llm-google — registers the Google provider into the
 * core `LLMProviderRegistry`.
 *
 * @module extensions/ext-llm-google
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import { GoogleProvider } from "./google-provider.ts";

const extGoogle: ExtensionFactory = () => {
  const provider = new GoogleProvider();
  let registryRef: LLMProviderRegistry | undefined;
  let registeredProvider = false;
  return {
    name: "ext-llm-google",
    version: "0.1.0",
    contracts: {
      provides: ["LLMProvider:google"],
      requires: [LLMProviderRegistryName],
    },
    capabilities: [],
    setup(ctx) {
      const registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registeredProvider = !registry.has(provider.id);
      registry.register(provider);
      ctx.provide("LLMProvider:google", registry.get(provider.id) ?? provider);
      registryRef = registry;
      ctx.logger.info("[ext-llm-google] Google provider registered");
    },
    teardown() {
      if (registeredProvider) registryRef?.unregister(provider.id);
      registeredProvider = false;
      registryRef = undefined;
    },
  };
};

export default extGoogle;
export { GoogleProvider };
