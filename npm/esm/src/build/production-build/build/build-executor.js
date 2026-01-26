/**
 * Build Executor Module
 *
 * Handles the execution of the actual build process:
 * - Building pages routes
 * - Building app routes
 * - Coordinating SSG options
 * - Aggregating build statistics
 */
import { serverLogger as logger } from "../../../utils/index.js";
import { buildAppRoutes, buildPagesRoutes } from "../static-generation.js";
/**
 * Execute the build process for all routes
 */
export async function executeBuild(pagesRoutes, appRoutes, options) {
    logger.info(`[BUILD] executeBuild: ${pagesRoutes.length} pages routes, ${appRoutes.length} app routes`);
    logger.info("Building pages...");
    const pagesStats = await buildPagesRoutes(pagesRoutes, options);
    logger.info(`[BUILD] pagesStats: ${pagesStats.pages} pages built`);
    const appStats = await buildAppRoutes(appRoutes, options);
    logger.info(`[BUILD] appStats: ${appStats.pages} pages built`);
    return {
        pages: pagesStats.pages + appStats.pages,
        totalSize: pagesStats.totalSize + appStats.totalSize,
        ssgPaths: pagesStats.ssgPaths.concat(appStats.ssgPaths),
    };
}
