import { compile as compileMdx } from "@mdx-js/mdx";
import { getRehypePlugins, getRemarkPlugins } from "@veryfront/transforms/plugins/plugin-loader.ts";
import type { CompileOptions, PluginList } from "./types.ts";

export interface ProcessedMDX {
  code: string;
  imports: string[];
}

export async function compileMDX(
  content: string,
  options: CompileOptions,
): Promise<ProcessedMDX> {
  const remarkPlugins = (await getRemarkPlugins()) as PluginList;
  const rehypePlugins = (await getRehypePlugins()) as PluginList;

  const compiled = await compileMdx(content, {
    outputFormat: "program",
    jsx: true,
    jsxRuntime: "automatic",
    jsxImportSource: "react",
    development: options.mode === "development",
    remarkPlugins,
    rehypePlugins,
  });

  const code = compiled.value as string;
  const imports = extractImports(code);

  return { code, imports };
}

function extractImports(code: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  return imports;
}
