/**
 * Routing Client
 *
 * @module routing/client
 */

export {
  applyHeadDirectives,
  executeScripts,
  extractPageDataFromScript,
  findAnchorElement,
  isInternalLink,
  manageFocus,
  parsePageDataFromHTML,
  updateMetaTags,
} from "./dom-utils.ts";

export { NavigationHandlers } from "./navigation-handlers.ts";
export type { NavigationCallbacks } from "./navigation-handlers.ts";

export { PageLoader } from "./page-loader.ts";
export type {
  ComponentMap,
  FrontmatterData,
  LayoutInfo,
  PageData,
  RouteData,
  SpaPageData,
} from "./page-loader.ts";

export { PageTransition } from "./page-transition.ts";

export { ViewportPrefetch } from "./viewport-prefetch.ts";
