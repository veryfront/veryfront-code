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
} from "./mdx-compiler/types.ts";

export { compileMDXFile } from "./mdx-compiler/compiler.ts";
export { compileAllMDX } from "./mdx-compiler/directory-compiler.ts";
export { watchMDX } from "./mdx-compiler/watcher.ts";
export { compileMDXToJS } from "./mdx-to-js.ts";

export * from "./mdx-compiler/index.ts";
