import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { CompileOptions } from "./types.ts";

interface ProcessedMDX {
  code: string;
  imports: string[];
}

export async function compileMDX(content: string, options: CompileOptions): Promise<ProcessedMDX> {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  const compiled = await processor.compileMdx({
    projectDir: options.projectDir,
    content,
    mode: options.mode,
    target: "server",
  });

  return { code: compiled.compiledCode, imports: extractImports(compiled.compiledCode) };
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
