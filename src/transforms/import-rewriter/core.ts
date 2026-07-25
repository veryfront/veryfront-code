import { applyImportEdits, parseImportEdits } from "./import-edit.ts";
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "./types.ts";

export interface TransformCoreInput {
  code: string;
  context: RewriteContext;
  strategies: ImportRewriteStrategy[];
}

export async function rewriteWithImportRewriteCore(input: TransformCoreInput): Promise<string> {
  const parsed = await parseImportEdits(input.code);
  if (parsed.imports.length === 0) return input.code;

  const rewrites = new Map<number, { specifier?: string | null; statement?: string }>();

  for (let i = 0; i < parsed.imports.length; i++) {
    const imp = parsed.imports[i]!;
    const result = rewriteOne(imp.specifier, imp, input.context, input.strategies);

    if (result.specifier !== null || result.statement !== undefined) {
      rewrites.set(i, result);
    }
  }

  if (rewrites.size === 0) return input.code;

  return applyImportEdits(parsed, rewrites);
}

function rewriteOne(
  specifier: string,
  info: ImportSpecifierInfo,
  ctx: RewriteContext,
  strategies: ImportRewriteStrategy[],
): RewriteResult {
  for (const strategy of strategies) {
    if (!strategy.matches(specifier, ctx)) continue;

    const result = strategy.rewrite(info, ctx);
    if (result.specifier !== null || result.statement !== undefined) return result;
  }

  return { specifier: null };
}
