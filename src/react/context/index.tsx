/**
 * React page-context exports for MDX and route-aware rendering.
 *
 * @module
 * @example
 * ```tsx
 * import { PageContextProvider, usePageContext } from "veryfront/context";
 * ```
 */
export {
  ImageManifestProvider,
  PageContextProvider,
  useOptimizedImageMetadata,
  usePageContext,
} from "../runtime/core.ts";
export type {
  ImageManifestProviderProps,
  MdxHeading,
  PageContextProviderProps,
  PageContextValue,
} from "../runtime/core.ts";
