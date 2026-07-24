import { applyImportEdits, type ParsedImportEdits } from "./import-edit.ts";

export {
  initLexer,
  parseImportEdits as parseAllImports,
  replaceImportSpecifiers as replaceSpecifiers,
} from "./import-edit.ts";

export type ParsedImports = ParsedImportEdits;

export function applyRewrites(
  _code: string,
  parsed: ParsedImportEdits,
  rewrites: Map<number, { specifier?: string | null; statement?: string }>,
): string {
  return applyImportEdits(parsed, rewrites);
}
