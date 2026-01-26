/**
 * Route Collector Module
 *
 * Handles collection of routes from the project:
 * - Pages routes collection
 * - App routes collection
 * - Route filtering based on include/exclude patterns
 */
import { serverLogger as logger } from "../../../utils/index.js";
import { collectAppRoutes, collectPagesRoutes } from "../../../server/build-routes.js";
export async function collectAllRoutes(adapter, projectDir, ssg, include, exclude) {
    if (!ssg) {
        logger.info("[BUILD] SSG disabled, skipping route collection");
        return { pages: [], app: [] };
    }
    const [pages, app] = await Promise.all([
        collectPagesRoutes(adapter, projectDir, include, exclude),
        collectAppRoutes(adapter, projectDir, include, exclude),
    ]);
    logger.info(`[BUILD] Collected routes: ${pages.length} pages, ${app.length} app`);
    if (app.length) {
        logger.info(`[BUILD] App routes: ${app.map((r) => r.path).join(", ")}`);
    }
    return { pages, app };
}
