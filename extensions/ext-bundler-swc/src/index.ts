/**
 * Opt-in SWC decorator-metadata transform extension.
 *
 * @module extensions/ext-bundler-swc
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { SwcBundler } from "./swc-bundler.ts";

const extSwc: ExtensionFactory = () => {
  const bundler = new SwcBundler();
  return {
    name: "ext-bundler-swc",
    version: "0.1.0",
    contracts: { provides: ["Bundler"] },
    capabilities: [{ type: "fs:read" }],
    setup(ctx) {
      ctx.provide("Bundler", bundler);
    },
    teardown() {
      return bundler.stop();
    },
  };
};

export default extSwc;
export { SwcBundler };
