import { defineError } from "../types.ts";

export const DEPLOYMENT_ERROR = defineError({
  slug: "deployment-error",
  category: "DEPLOY",
  status: 500,
  title: "Deployment process failed",
  suggestion: "Check deployment logs for details",
});

export const PLATFORM_ERROR = defineError({
  slug: "platform-error",
  category: "DEPLOY",
  status: 500,
  title: "Platform-specific error",
  suggestion: "Check platform documentation and requirements",
});

export const ENV_VAR_MISSING = defineError({
  slug: "env-var-missing",
  category: "DEPLOY",
  status: 500,
  title: "Required environment variable missing",
  suggestion: "Set the required environment variable",
});

export const PRODUCTION_BUILD_REQUIRED = defineError({
  slug: "production-build-required",
  category: "DEPLOY",
  status: 400,
  title: "Production build required",
  suggestion: "Run 'vf build' before deploying",
});

/** Registry fragment for DEPLOY errors (slug → definition). */
export const DEPLOY_REGISTRY = {
  "deployment-error": DEPLOYMENT_ERROR,
  "platform-error": PLATFORM_ERROR,
  "env-var-missing": ENV_VAR_MISSING,
  "production-build-required": PRODUCTION_BUILD_REQUIRED,
} as const;
