/**
 * Transforms Plugins
 *
 * `getRemarkPlugins` / `getRehypePlugins` are thin shims that resolve the
 * `ContentTransformer` contract (default implementation: `@veryfront/ext-content-mdx`).
 * The actual plugin modules (remark-headings, remark-mdx-utils, rehype-mermaid,
 * rehype-node-positions) now live inside the extension.
 *
 * `babel-node-positions` is an unrelated Babel AST pass that stays in core.
 *
 * @module transforms/plugins
 */

export { getRehypePlugins, getRemarkPlugins } from "./plugin-loader.ts";
export { injectNodePositions } from "./babel-node-positions.ts";
