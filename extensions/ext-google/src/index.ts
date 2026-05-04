/**
 * @veryfront/ext-google — registers the Google provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-google
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { GoogleProvider } from "./google-provider.ts";

const extGoogle: ExtensionFactory = () => {
  const provider = new GoogleProvider();
  return {
    name: "ext-google",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:google" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-google] Google provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extGoogle;
export { GoogleProvider };
