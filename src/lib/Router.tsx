/**
 * Re-export router from veryfront/router for backward compatibility.
 *
 * This file exists to support legacy imports like `import { useRouter } from "@/lib/Router"`.
 * All functionality is provided by the veryfront/router package.
 *
 * IMPORTANT: Do not add RouterContext or useRouter implementations here!
 * Doing so creates a separate React context that won't receive values from
 * the framework's RouterProvider, causing SSR/hydration mismatches.
 */

// Re-export all runtime exports
// Note: Use "veryfront/router" (not "veryfront/react/router") to match browser import map
export { Router, RouterProvider, useRouter } from "veryfront/router";

// Re-export types - RouterValue is the new name for the Router type
export type { RouterProviderProps, RouterValue } from "veryfront/router";

// Backward compatibility: export RouterValue as Router type for old code
// that imports `import type { Router } from "@/lib/Router"`
import type { RouterValue } from "veryfront/router";
export type Router = RouterValue;
