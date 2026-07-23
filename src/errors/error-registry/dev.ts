import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the hmr-error slug. */
export const HMR_ERROR: RegisteredError = defineError({
  slug: "hmr-error",
  category: "DEV",
  status: 500,
  title: "Hot module replacement error",
  suggestion: "Restart the development server",
});

/** Registered error definition for the dev-server-error slug. */
export const DEV_SERVER_ERROR: RegisteredError = defineError({
  slug: "dev-server-error",
  category: "DEV",
  status: 500,
  title: "Development server error",
  suggestion: "Check the dev server logs and restart",
});

/** Registered error definition for the fast-refresh-error slug. */
export const FAST_REFRESH_ERROR: RegisteredError = defineError({
  slug: "fast-refresh-error",
  category: "DEV",
  status: 500,
  title: "Fast refresh failed",
  suggestion: "Save the file again or restart the dev server",
});

/** Registered error definition for the error-overlay-error slug. */
export const ERROR_OVERLAY_ERROR: RegisteredError = defineError({
  slug: "error-overlay-error",
  category: "DEV",
  status: 500,
  title: "Error overlay failed",
  suggestion: "Check browser console for details",
});

/** Registered error definition for the source-map-error slug. */
export const SOURCE_MAP_ERROR: RegisteredError = defineError({
  slug: "source-map-error",
  category: "DEV",
  status: 500,
  title: "Source map loading error",
  suggestion: "Rebuild or clear cache",
});

/** Registry fragment for DEV errors (slug → definition). */
export const DEV_REGISTRY: ErrorRegistryFragment<
  | "hmr-error"
  | "dev-server-error"
  | "fast-refresh-error"
  | "error-overlay-error"
  | "source-map-error"
> = Object.freeze(
  {
    "hmr-error": HMR_ERROR,
    "dev-server-error": DEV_SERVER_ERROR,
    "fast-refresh-error": FAST_REFRESH_ERROR,
    "error-overlay-error": ERROR_OVERLAY_ERROR,
    "source-map-error": SOURCE_MAP_ERROR,
  } as const,
);
