/**
 * Module Handler - Barrel Exports
 *
 * ES module serving and page module generation handler with modular architecture.
 *
 * @module server/handlers/request/module
 */

// Export main handler
export { ModuleHandler } from "./module-handler.ts";

// Export utilities (for testing/advanced usage)
export { getRendererForProject } from "../../../shared/renderer-factory.ts";
export { handleModuleServer } from "./module-server-handler.ts";
export { handleVirtualModule } from "./virtual-module-handler.ts";
export { handlePageModule } from "./page-module-handler.ts";
export { handleDataEndpoint } from "./data-endpoint-handler.ts";
export { handlePageDataEndpoint } from "./page-data-endpoint-handler.ts";
export { handleBatchModuleEndpoint } from "./batch-module-handler.ts";
