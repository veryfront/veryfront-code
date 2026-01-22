/**
 * Server Context Module
 *
 * Provides request-scoped context for handling requests.
 *
 * @module server/context
 */

export {
  createRequestContext,
  getCacheStrategy,
  isLocalDev,
  type RequestContext,
  shouldEnableCache,
} from "./request-context.ts";
