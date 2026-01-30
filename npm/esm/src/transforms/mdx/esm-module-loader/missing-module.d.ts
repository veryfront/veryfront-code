/**
 * Missing module error helpers for MDX ESM loader.
 */
type MissingModuleContext = {
    modulePath: string;
    importer?: string;
    importStatement?: string;
    code?: string;
    projectSlug?: string;
};
export declare function buildMissingModuleError(ctx: MissingModuleContext): Error;
export {};
//# sourceMappingURL=missing-module.d.ts.map