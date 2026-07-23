import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { CompileOptions } from "./types.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";

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

  const imports = await parseImports(compiled.compiledCode);
  return {
    code: compiled.compiledCode,
    imports: [...new Set(imports.flatMap((entry) => entry.n ? [entry.n] : []))],
  };
}
