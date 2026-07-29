import type { ExtensionFactory } from "veryfront/extensions";
import { Parse5HTMLHeadLocator } from "./parser-only.ts";

const extParse5: ExtensionFactory = () => {
  const locator = new Parse5HTMLHeadLocator();

  return {
    name: "ext-parser-parse5",
    version: "0.1.0",
    contracts: {
      provides: ["HTMLHeadLocator"],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide("HTMLHeadLocator", locator);
      ctx.logger.info("[ext-parser-parse5] HTMLHeadLocator registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extParse5;
export { Parse5HTMLHeadLocator };
