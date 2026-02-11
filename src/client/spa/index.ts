/**
 * Client Spa
 *
 * @module client/spa
 */

export { ClientApp, type PageDataResponse } from "./ClientApp.tsx";
export { type LayoutInfo, LayoutShell } from "./LayoutShell.tsx";
export {
  clearComponentCache,
  getCachedComponent,
  loadComponent,
  preloadComponent,
} from "./component-loader.ts";
export { getModuleServerUrl, getPathToModuleUrlScript, pathToModuleUrl } from "./path-utils.ts";
