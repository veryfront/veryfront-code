// Types (stay in this module)
export type {
  Adapter,
  FrontmatterMetadata,
  LogContext,
  MDXComponentProps,
  MDXContentProps,
  MDXModule,
} from "./types.ts";

// Loaders (stay in this module - different signatures from esm-module-loader)
export { loadMDXModule } from "./loader.ts";
export { isESMModule, loadESMModule } from "./esm-loader.ts";

// Re-exports from new consolidated locations (backwards compatibility)
export {
  extractComponentImports,
  resolveComponents,
} from "../esm-module-loader/components/resolver.ts";
export {
  extractFrontmatter,
  extractMetadata,
  mergeFrontmatter,
} from "../esm-module-loader/metadata/index.ts";
export { loadJSXRuntime } from "../esm-module-loader/jsx/runtime-loader.ts";
export {
  cleanModuleCode,
  extractBalancedBlock,
  parseJsonish,
} from "../esm-module-loader/metadata/string-parser.ts";
