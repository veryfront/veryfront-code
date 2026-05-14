/**
 * ext-mdx: ContentProcessor implementation backed by MDX + remark/rehype.
 *
 * Provides the `ContentProcessor` contract:
 *  - `compileMdx(options)` runs @mdx-js/mdx through Veryfront's remark +
 *    rehype plugin stack and returns compiled ESM plus extracted headings
 *    and frontmatter.
 *  - `compileMarkdown(options)` runs a unified markdown pipeline
 *    (remark-parse to remark-rehype to rehype-sanitize to rehype-stringify)
 *    producing sanitized HTML wrapped in a React component.
 *
 * Core's `src/transforms/md/compiler` and `src/transforms/mdx/compiler`
 * resolve this contract at call time. When the extension is not installed,
 * core throws an actionable install message (see
 * `src/extensions/recommendations.ts`).
 *
 * @module extensions/ext-transform-mdx
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  ContentCompileOptions,
  ContentPlugin,
  ContentProcessingResult,
  ContentProcessor,
} from "veryfront/extensions/transform";
import { compileMdx } from "./compiler/mdx-compile.ts";
import { compileMarkdown } from "./compiler/markdown-compile.ts";
import { getRehypePlugins, getRemarkPlugins } from "./plugins/plugin-loader.ts";

class MdxContentProcessor implements ContentProcessor {
  compileMdx(options: ContentCompileOptions): Promise<ContentProcessingResult> {
    return compileMdx(options);
  }
  compileMarkdown(options: ContentCompileOptions): Promise<ContentProcessingResult> {
    return compileMarkdown(options);
  }
  getRemarkPlugins(): ContentPlugin[] {
    return getRemarkPlugins() as ContentPlugin[];
  }
  getRehypePlugins(): ContentPlugin[] {
    return getRehypePlugins() as ContentPlugin[];
  }
}

const extMdx: ExtensionFactory = () => {
  const impl = new MdxContentProcessor();
  return {
    name: "ext-transform-mdx",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "ContentProcessor" }],
    setup(ctx) {
      ctx.provide("ContentProcessor", impl);
      ctx.logger.info("[ext-mdx] ContentProcessor registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extMdx;
export { MdxContentProcessor };
