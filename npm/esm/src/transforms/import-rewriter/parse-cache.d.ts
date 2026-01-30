/**
 * Parse cache for es-module-lexer.
 *
 * Single parse per file - reused across all strategies.
 * This eliminates redundant parsing that happened with the fragmented system.
 */
import type { ImportSpecifierInfo } from "./types.js";
/**
 * Initialize es-module-lexer (must be called before parsing).
 */
export declare function initLexer(): Promise<void>;
/**
 * Parsed import information with position data.
 */
export interface ParsedImports {
    /** All imports found in the code */
    imports: ImportSpecifierInfo[];
    /** URL map for restoring masked HTTP URLs */
    urlMap: Map<string, string>;
    /** Original masked code (for position calculations) */
    maskedCode: string;
}
/**
 * Parse all imports from code using es-module-lexer.
 * Returns structured import info with position data.
 */
export declare function parseAllImports(code: string): Promise<ParsedImports>;
/**
 * Apply import rewrites to code.
 *
 * Takes the parsed imports and a map of specifier -> replacement.
 * Applies replacements from end to start to preserve positions.
 *
 * IMPORTANT: Positions from es-module-lexer are relative to the masked code
 * (HTTP URLs replaced with short placeholders). We must apply rewrites to the
 * masked code first, then unmask the final result to restore any untouched URLs.
 */
export declare function applyRewrites(_code: string, parsed: ParsedImports, rewrites: Map<number, {
    specifier?: string | null;
    statement?: string;
}>): string;
/**
 * Simple specifier replacement (for strategies that don't need full statement control).
 */
export declare function replaceSpecifiers(code: string, replacer: (specifier: string, isDynamic: boolean) => string | null | undefined): Promise<string>;
//# sourceMappingURL=parse-cache.d.ts.map