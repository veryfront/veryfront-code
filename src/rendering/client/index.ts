/**
 * Rendering Client
 *
 * @module rendering/client
 */

export {
  initPrefetch,
  PrefetchManager,
  type PrefetchOptions,
  type ResourceHint,
} from "./prefetch.ts";
export {
  type RouteData,
  type RouterOptions,
  type SpaNavigationHandler,
  type SpaPageData,
  VeryfrontRouter,
} from "./router.ts";
export { getStateBridge, SharedState, type StateStore, useBridgedState } from "./state-bridge.ts";
