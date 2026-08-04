/**
 * react-markdown implementation of the `MarkdownRendererProvider` extension
 * contract.
 *
 * @module extensions/ext-markdown-react
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  createMarkdownRendererProvider,
  MarkdownRendererProviderName,
} from "veryfront/extensions/markdown";
import extensionPackage from "../deno.json" with { type: "json" };
import { MarkdownRenderer } from "./renderer.tsx";

const extMarkdownReact: ExtensionFactory = () => {
  const provider = createMarkdownRendererProvider("ext-markdown-react", MarkdownRenderer);

  return {
    name: "ext-markdown-react",
    version: extensionPackage.version,
    contracts: {
      provides: [MarkdownRendererProviderName],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide(MarkdownRendererProviderName, provider);
      ctx.logger.debug("[ext-markdown-react] MarkdownRendererProvider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extMarkdownReact;
export { MarkdownRenderer } from "./renderer.tsx";
