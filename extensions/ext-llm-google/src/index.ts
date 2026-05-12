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
  return {
    name: "ext-llm-google",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "LLMProvider:google" }],
    setup(ctx) {
      const registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-llm-google] Google provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extGoogle;
export { GoogleProvider };
