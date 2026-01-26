import type { EmbeddedBundleManifest } from "../renderer/types/bundler-types.js";
export interface BuildEmbeddedOptions {
    projectDir: string;
    outDir: string;
    runtime: "deno" | "node" | "bun";
}
/**
 * Build the embedded preset bundle.
 * Outputs:
 * - outDir/embedded/manifest.json
 * - outDir/embedded/app.js (SSR entry)
 * - outDir/embedded/rsc/*.js (RSC support)
 */
export declare function buildEmbeddedPreset(options: BuildEmbeddedOptions): Promise<{
    manifest: EmbeddedBundleManifest;
}>;
//# sourceMappingURL=preset.d.ts.map