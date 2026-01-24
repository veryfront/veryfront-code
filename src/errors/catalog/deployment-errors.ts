import { ErrorCode } from "../error-codes.ts";
import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

export const DEPLOYMENT_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.DEPLOYMENT_ERROR]: createSimpleError(
    ErrorCode.DEPLOYMENT_ERROR,
    "Deployment failed",
    "Failed to deploy application.",
    [
      "Check deployment logs for details",
      "Verify platform credentials",
      "Ensure build succeeded first",
    ],
  ),
  [ErrorCode.PLATFORM_ERROR]: createSimpleError(
    ErrorCode.PLATFORM_ERROR,
    "Platform error",
    "Deployment platform returned an error.",
    ["Check platform status page", "Verify API keys and credentials", "Try deploying again"],
  ),
  [ErrorCode.ENV_VAR_MISSING]: createSimpleError(
    ErrorCode.ENV_VAR_MISSING,
    "Environment variable missing",
    "Required environment variable is not set.",
    [
      "Add variable to .env file",
      "Set variable in deployment platform",
      "Check variable name is correct",
    ],
  ),
  [ErrorCode.PRODUCTION_BUILD_REQUIRED]: createSimpleError(
    ErrorCode.PRODUCTION_BUILD_REQUIRED,
    "Production build required",
    "Must build project before deploying.",
    [
      "Run 'veryfront build' first",
      "Check that dist/ directory exists",
      "Verify build completed successfully",
    ],
  ),
};
