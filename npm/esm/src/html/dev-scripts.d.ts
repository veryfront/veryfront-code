export declare function getDevStyles(nonce?: string): string;
export declare function getDevScripts(_hmrPort?: number, nonce?: string): string;
export declare function getProdScripts(slug: string, nonce?: string): string;
export interface StudioScriptOptions {
    projectId: string;
    pageId: string;
    pagePath?: string;
    nonce?: string;
    /** Hash of source code for sync detection with Navigator tree */
    sourceHash?: string;
}
export declare function getStudioScripts(options: StudioScriptOptions): string;
//# sourceMappingURL=dev-scripts.d.ts.map