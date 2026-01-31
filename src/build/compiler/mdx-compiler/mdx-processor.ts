import { compile as compileMdx, type CompileOptions as MDXCompileOptions } from "@mdx-js/mdx";
import { getRehypePlugins, getRemarkPlugins } from "#veryfront/transforms/plugins/plugin-loader.ts";
import type { CompileOptions } from "./types.ts";

type MDXPluggable = NonNullable<MDXCompileOptions["remarkPlugins"]>[number];

export interface ProcessedMDX {
  code: string;
  imports: string[];
}

export async function compileMDX(content: string, options: CompileOptions): Promise<ProcessedMDX> {
  const [remarkPlugins, rehypePlugins] = await Promise.all([
    getRemarkPlugins(),
    getRehypePlugins(),
  ]);

  const compiled = await compileMdx(content, {
    outputFormat: "program",
    jsx: true,
    jsxRuntime: "automatic",
    jsxImportSource: "react",
    development: options.mode === "development",
    remarkPlugins: remarkPlugins as MDXPluggable[],
    rehypePlugins: rehypePlugins as MDXPluggable[],
  });

  const code = String(compiled.value);

  return { code, imports: extractImports(code) };
}

function extractImports(code: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const match of code.matchAll(importRegex)) {
    const specifier = match[1];
    if (specifier) imports.push(specifier);
  }

  return imports;
}
