import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

export const DEPLOYMENT_ERROR_CATALOG: PartialErrorCatalog = {
  "deployment-error": createSimpleError(
    "deployment-error",
    "Deployment failed",
    "Failed to deploy application.",
    [
      "Check deployment logs for details",
      "Verify platform credentials",
      "Ensure build succeeded first",
    ],
  ),

  "platform-error": createSimpleError(
    "platform-error",
    "Platform error",
    "Deployment platform returned an error.",
    ["Check platform status page", "Verify API keys and credentials", "Try deploying again"],
  ),

  "env-var-missing": createSimpleError(
    "env-var-missing",
    "Environment variable missing",
    "Required environment variable is not set.",
    [
      "Add variable to .env file",
      "Set variable in deployment platform",
      "Check variable name is correct",
    ],
  ),

  "production-build-required": createSimpleError(
    "production-build-required",
    "Production build required",
    "Must build project before deploying.",
    [
      "Run 'veryfront build' first",
      "Check that dist/ directory exists",
      "Verify build completed successfully",
    ],
  ),
};
