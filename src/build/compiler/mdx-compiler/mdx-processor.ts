import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentModuleValues, ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";
import type { CompileOptions } from "./types.ts";

interface ProcessedMDX {
  code: string;
  imports: string[];
}

export async function compileMDX(
  content: string,
  options: CompileOptions,
  moduleValues?: ContentModuleValues,
): Promise<ProcessedMDX> {
  const processor = resolveContract<ContentProcessor>("ContentProcessor");
  const compiled = await processor.compileMdx({
    projectDir: options.projectDir,
    content,
    mode: options.mode,
    target: "server",
    moduleValues,
  });

  return {
    code: compiled.compiledCode,
    imports: await extractImports(compiled.compiledCode),
  };
}

async function extractImports(code: string): Promise<string[]> {
  const parsed = await parseAllImports(code);
  return [...new Set(parsed.imports.map(({ specifier }) => specifier))];
}
