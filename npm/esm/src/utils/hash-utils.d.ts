export declare function computeHash(content: string): Promise<string>;
/** @deprecated Use computeHash directly */
export declare const getContentHash: typeof computeHash;
/** @deprecated Use computeHash directly */
export declare const computeContentHash: typeof computeHash;
export interface BundleCode {
    code: string;
    css?: string;
    sourceMap?: string;
}
export declare function computeCodeHash(code: BundleCode): Promise<string>;
export declare function simpleHash(str: string): number;
export declare function shortHash(content: string): Promise<string>;
//# sourceMappingURL=hash-utils.d.ts.map