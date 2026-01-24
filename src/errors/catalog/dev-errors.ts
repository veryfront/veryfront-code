import { ErrorCode } from "../error-codes.ts";
import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

export const DEV_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.DEV_SERVER_ERROR]: createSimpleError(
    ErrorCode.DEV_SERVER_ERROR,
    "Development server error",
    "Error in development server.",
    ["Check server logs for details", "Try restarting dev server", "Clear cache and restart"],
  ),

  [ErrorCode.FAST_REFRESH_ERROR]: createSimpleError(
    ErrorCode.FAST_REFRESH_ERROR,
    "Fast Refresh error",
    "React Fast Refresh failed.",
    [
      "Check for syntax errors",
      "Ensure components follow Fast Refresh rules",
      "Try full page refresh",
    ],
  ),

  [ErrorCode.ERROR_OVERLAY_ERROR]: createSimpleError(
    ErrorCode.ERROR_OVERLAY_ERROR,
    "Error overlay failed",
    "Could not display error overlay.",
    ["Check browser console for details", "Try disabling browser extensions", "Refresh the page"],
  ),

  [ErrorCode.SOURCE_MAP_ERROR]: createSimpleError(
    ErrorCode.SOURCE_MAP_ERROR,
    "Source map error",
    "Error loading or parsing source map.",
    [
      "Check that source maps are enabled",
      "Try rebuilding the project",
      "Check for corrupted build files",
    ],
  ),
};
