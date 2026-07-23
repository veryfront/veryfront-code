/** MDX and Markdown compilation entry points. @module build/compiler */

export type {
  CompileOptions,
  CompileResult,
  MDXFrontmatter,
  PluginList,
} from "./mdx-compiler/types.ts";

export { compileMDXFile } from "./mdx-compiler/compiler.ts";
export { compileAllMDX } from "./mdx-compiler/directory-compiler.ts";
export { watchMDX } from "./mdx-compiler/watcher.ts";
export { compileMDXToJS, type CompileToJSOptions, type CompileToJSResult } from "./mdx-to-js.ts";
