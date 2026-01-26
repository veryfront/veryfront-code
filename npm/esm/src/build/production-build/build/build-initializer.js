import { join } from "../../../platform/compat/path/index.js";
// Direct import from registry.ts to avoid circular dependency through barrel
import { runtime } from "../../../platform/adapters/registry.js";
import { getConfig } from "../../../config/index.js";
import { createRenderer } from "../../../rendering/index.js";
export async function initializeBuildContext(options) {
    const adapter = await runtime.get();
    const config = await getConfig(options.projectDir, adapter);
    const renderer = await createRenderer({
        projectDir: options.projectDir,
        mode: "production",
        adapter,
    });
    return {
        adapter,
        config,
        renderer,
        options,
        stats: {
            pages: 0,
            components: 0,
            chunks: 0,
            assets: 0,
            totalSize: 0,
            duration: 0,
        },
    };
}
export function normalizeBuildOptions(options) {
    const outputDir = options.outputDir ?? join(options.projectDir, ".veryfront", "output");
    return {
        projectDir: options.projectDir,
        outputDir,
        enableSplitting: options.enableSplitting ?? true,
        enableCompression: options.enableCompression ?? true,
        enablePrefetch: options.enablePrefetch ?? true,
        ssg: options.ssg ?? true,
        include: options.include,
        exclude: options.exclude,
        dryRun: options.dryRun ?? false,
    };
}
