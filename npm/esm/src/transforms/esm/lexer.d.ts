export declare function initLexer(): Promise<void>;
export type ImportSpecifier = {
    n: string | undefined;
    s: number;
    e: number;
    ss: number;
    se: number;
    d: number;
    a: number;
};
export declare function parseImports(code: string): Promise<readonly ImportSpecifier[]>;
/**
 * Replace import specifiers (the path string) in the code.
 * Safe for simple re-mappings like aliases or rewriting URLs.
 */
export declare function replaceSpecifiers(code: string, replacer: (specifier: string, isDynamic: boolean) => string | null | undefined): Promise<string>;
/**
 * Rewrite entire import statements.
 * Useful for complex transformations like vendor splitting.
 */
export declare function rewriteImports(code: string, rewriter: (imp: ImportSpecifier, statement: string) => string | null): Promise<string>;
//# sourceMappingURL=lexer.d.ts.map