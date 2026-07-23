import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the deployment-error slug. */
export const DEPLOYMENT_ERROR: RegisteredError = defineError({
  slug: "deployment-error",
  category: "DEPLOY",
  status: 500,
  title: "Deployment process failed",
  suggestion: "Check deployment logs for details",
});

/** Registered error definition for the platform-error slug. */
export const PLATFORM_ERROR: RegisteredError = defineError({
  slug: "platform-error",
  category: "DEPLOY",
  status: 500,
  title: "Platform-specific error",
  suggestion: "Check platform documentation and requirements",
});

/** Registered error definition for the env-var-missing slug. */
export const ENV_VAR_MISSING: RegisteredError = defineError({
  slug: "env-var-missing",
  category: "DEPLOY",
  status: 500,
  title: "Required environment variable missing",
  suggestion: "Set the required environment variable",
});

/** Registered error definition for the production-build-required slug. */
export const PRODUCTION_BUILD_REQUIRED: RegisteredError = defineError({
  slug: "production-build-required",
  category: "DEPLOY",
  status: 400,
  title: "Production build required",
  suggestion: "Run 'veryfront build' before deploying",
});

/** Registry fragment for DEPLOY errors (slug → definition). */
export const DEPLOY_REGISTRY: ErrorRegistryFragment<
  | "deployment-error"
  | "platform-error"
  | "env-var-missing"
  | "production-build-required"
> = Object.freeze(
  {
    "deployment-error": DEPLOYMENT_ERROR,
    "platform-error": PLATFORM_ERROR,
    "env-var-missing": ENV_VAR_MISSING,
    "production-build-required": PRODUCTION_BUILD_REQUIRED,
  } as const,
);
