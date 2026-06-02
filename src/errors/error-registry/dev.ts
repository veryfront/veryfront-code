import { defineError } from "../types.ts";

export const HMR_ERROR = defineError({
  slug: "hmr-error",
  category: "DEV",
  status: 500,
  title: "Hot module replacement error",
  suggestion: "Restart the development server",
});

export const DEV_SERVER_ERROR = defineError({
  slug: "dev-server-error",
  category: "DEV",
  status: 500,
  title: "Development server error",
  suggestion: "Check the dev server logs and restart",
});

export const FAST_REFRESH_ERROR = defineError({
  slug: "fast-refresh-error",
  category: "DEV",
  status: 500,
  title: "Fast refresh failed",
  suggestion: "Save the file again or restart the dev server",
});

export const ERROR_OVERLAY_ERROR = defineError({
  slug: "error-overlay-error",
  category: "DEV",
  status: 500,
  title: "Error overlay failed",
  suggestion: "Check browser console for details",
});

export const SOURCE_MAP_ERROR = defineError({
  slug: "source-map-error",
  category: "DEV",
  status: 500,
  title: "Source map loading error",
  suggestion: "Rebuild or clear cache",
});

/** Registry fragment for DEV errors (slug → definition). */
export const DEV_REGISTRY = {
  "hmr-error": HMR_ERROR,
  "dev-server-error": DEV_SERVER_ERROR,
  "fast-refresh-error": FAST_REFRESH_ERROR,
  "error-overlay-error": ERROR_OVERLAY_ERROR,
  "source-map-error": SOURCE_MAP_ERROR,
} as const;
