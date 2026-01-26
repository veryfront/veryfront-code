import { serverLogger as logger } from "../../../utils/index.js";
import { join } from "../../../platform/compat/path/index.js";
import { handleErrorWithFallback } from "../../../errors/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
export async function setupBuildDirectories(adapter, outputDir, dryRun) {
    logger.info("Setting up build directories...");
    await handleErrorWithFallback(() => adapter.fs.remove(outputDir, { recursive: true }), undefined, logger);
    if (dryRun) {
        logger.info("Build directories ready");
        return;
    }
    const fs = createFileSystem();
    const dirs = [
        outputDir,
        join(outputDir, "_veryfront"),
        join(outputDir, "_veryfront/chunks"),
        join(outputDir, "_veryfront/data"),
        join(outputDir, "assets"),
    ];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        }
        catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? error.code
                : undefined;
            if (code === "EEXIST")
                continue;
            throw error;
        }
    }
    logger.info("Build directories ready");
}
