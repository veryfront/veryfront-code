import { compile as compileMdx, type CompileOptions as MDXCompileOptions } from "@mdx-js/mdx";
import { getRehypePlugins, getRemarkPlugins } from "../../../transforms/plugins/plugin-loader.js";
import type { CompileOptions } from "./types.js";

type MDXPluggable = NonNullable<MDXCompileOptions["remarkPlugins"]>[number];

export interface ProcessedMDX {
  code: string;
  imports: string[];
}

export async function compileMDX(
  content: string,
  options: CompileOptions,
): Promise<ProcessedMDX> {
  const remarkPlugins = (await getRemarkPlugins()) as MDXPluggable[];
  const rehypePlugins = (await getRehypePlugins()) as MDXPluggable[];

  const compiled = await compileMdx(content, {
    outputFormat: "program",
    jsx: true,
    jsxRuntime: "automatic",
    jsxImportSource: "react",
    development: options.mode === "development",
    remarkPlugins,
    rehypePlugins,
  });

  const code = String(compiled.value);
  const imports = extractImports(code);

  return { code, imports };
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
