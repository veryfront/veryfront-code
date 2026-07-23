/**
 * HTML hydration script builder.
 *
 * @module html/hydration-script-builder
 */

export type { HydrationDataStructure, HydrationLayout } from "./types.ts";

export { generateHydrationData } from "./hydration-data-generator.ts";

export { getDevScripts } from "./dev-scripts.ts";
export { generateDevErrorLoggerScript } from "./dev-error-logger.ts";
export { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
export { generateDevClientRendererScript } from "./dev-client-renderer.ts";

export {
  generateProdHydrationModule,
  getProdHydrationModulePath,
  getProdScripts,
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
  PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN,
} from "./prod-scripts.ts";
export { generateProdHydrationScript } from "./prod-hydration.ts";
