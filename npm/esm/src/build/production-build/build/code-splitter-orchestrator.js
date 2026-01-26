/**
 * Code Splitter Orchestrator Module
 *
 * Handles code splitting orchestration:
 * - Configuring the code splitter
 * - Running the splitting process
 * - Managing chunk manifests
 */
import { serverLogger as logger } from "../../../utils/index.js";
import { join } from "../../../platform/compat/path/index.js";
import { createCodeSplitter } from "../../bundler/index.js";
/**
 * Run code splitting on the provided routes
 */
export async function runCodeSplitting(projectDir, outputDir, routes, enableSplitting, dryRun) {
    if (!enableSplitting || dryRun || routes.length === 0) {
        return { manifest: null, chunks: 0 };
    }
    logger.info("Running code splitter...");
    const splitter = createCodeSplitter({
        projectDir,
        outDir: join(outputDir, "_veryfront/chunks"),
        mode: "production",
        routes: routes.map(({ path, file, slug }) => ({
            path,
            file,
            name: slug.replace(/\//g, "-"),
        })),
        shared: ["react", "react-dom"],
        external: [],
    });
    const { entries, shared, manifest } = await splitter.split();
    const chunks = entries.size + shared.size;
    logger.info(`Created ${chunks} chunks`);
    return { manifest, chunks };
}
