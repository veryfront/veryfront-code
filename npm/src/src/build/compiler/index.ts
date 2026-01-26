/**
 * Compiler module - Unified exports for MDX compilation
 *
 * Provides barrel exports to simplify deep import paths within the build system.
 * Instead of importing from `./compiler/mdx-compiler/index.ts`, use `./compiler/index.ts`
 *
 * @module build/compiler
 */

export type {
  CompileOptions,
  CompileResult,
  MDXFrontmatter,
  PluginList,
} from "./mdx-compiler/types.js";

export { compileMDXFile } from "./mdx-compiler/compiler.js";
export { compileAllMDX } from "./mdx-compiler/directory-compiler.js";
export { watchMDX } from "./mdx-compiler/watcher.js";
export { compileMDXToJS } from "./mdx-to-js.js";

export * from "./mdx-compiler/index.js";
