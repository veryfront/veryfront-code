/**
 * Mdx - Module Loader
 *
 * @module transforms/mdx/module-loader
 */

// Types (stay in this module)
export type {
  Adapter,
  FrontmatterMetadata,
  LogContext,
  MDXComponentProps,
  MDXContentProps,
  MDXModule,
} from "./types.ts";

// Loaders only.
export { loadMDXModule } from "./loader.ts";
export { isESMModule, loadESMModule } from "./esm-loader.ts";
