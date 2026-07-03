/**
 * React router exports for client navigation and route context.
 *
 * @module
 * @example
 * ```tsx
 * import { Link, RouterProvider, useRouter } from "veryfront/router";
 * ```
 */
export {
  Link,
  Router,
  RouterProvider,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "../runtime/core.ts";
export type { LinkProps, RouterProviderProps, RouterValue } from "../runtime/core.ts";
