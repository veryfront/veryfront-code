/**
 * Configuration hash for transform cache keys.
 *
 * Computes a hash of transform-affecting configuration to ensure
 * cache entries are invalidated when configuration changes.
 */
/**
 * Configuration that affects transform output.
 */
export interface TransformConfig {
    /** React version for esm.sh URLs */
    reactVersion?: string;
    /** JSX import source */
    jsxImportSource?: string;
    /** Enable Studio Navigator embed */
    studioEmbed?: boolean;
    /** Development mode */
    dev?: boolean;
}
/**
 * Compute a hash of transform-affecting configuration.
 *
 * Changes to these values should invalidate cached transforms.
 */
export declare function computeConfigHash(config: TransformConfig): Promise<string>;
/**
 * Compute a quick config hash synchronously (less fields, faster).
 *
 * Use this when you need a config hash but can't afford async overhead.
 */
export declare function computeConfigHashSync(config: TransformConfig): string;
//# sourceMappingURL=config-hash.d.ts.map