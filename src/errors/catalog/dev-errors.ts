import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

export const DEV_ERROR_CATALOG: PartialErrorCatalog = {
  "dev-server-error": createSimpleError(
    "dev-server-error",
    "Development server error",
    "Error in development server.",
    ["Check server logs for details", "Try restarting dev server", "Clear cache and restart"],
  ),

  "fast-refresh-error": createSimpleError(
    "fast-refresh-error",
    "Fast Refresh error",
    "React Fast Refresh failed.",
    [
      "Check for syntax errors",
      "Ensure components follow Fast Refresh rules",
      "Try full page refresh",
    ],
  ),

  "error-overlay-error": createSimpleError(
    "error-overlay-error",
    "Error overlay failed",
    "Could not display error overlay.",
    ["Check browser console for details", "Try disabling browser extensions", "Refresh the page"],
  ),

  "source-map-error": createSimpleError(
    "source-map-error",
    "Source map error",
    "Error loading or parsing source map.",
    [
      "Check that source maps are enabled",
      "Try rebuilding the project",
      "Check for corrupted build files",
    ],
  ),
};
