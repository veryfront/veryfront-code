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
  suggestion: "Run 'veryfront build' before deploying",
});

export const ENVIRONMENT_NOT_FOUND = defineError({
  slug: "environment-not-found",
  category: "DEPLOY",
  status: 404,
  title: "Deployment environment not found",
  suggestion: "Check environment names with: veryfront config",
});

export const ENVIRONMENT_NOT_ROUTABLE = defineError({
  slug: "environment-not-routable",
  category: "DEPLOY",
  status: 400,
  title: "Environment name has no Veryfront-hosted address",
  suggestion:
    "Deploy to preview, staging, or production, or attach a custom domain to this environment in Studio",
});

export const RELEASE_MISSING_VERSION = defineError({
  slug: "release-missing-version",
  category: "DEPLOY",
  status: 500,
  title: "Release has no version",
  suggestion: "Try again or check the build logs in Studio",
});

export const RELEASE_BUILD_TIMEOUT = defineError({
  slug: "release-build-timeout",
  category: "DEPLOY",
  status: 408,
  title: "Release build timed out",
  suggestion: "Try again or check the build logs in Studio",
});

export const DEPLOYMENT_VERIFICATION_TIMEOUT = defineError({
  slug: "deployment-verification-timeout",
  category: "DEPLOY",
  status: 408,
  title: "Deployment verification timed out",
  suggestion: "Try again or check the deployment status in Studio",
});

export const PUSH_RECEIPT_MISSING = defineError({
  slug: "push-receipt-missing",
  category: "DEPLOY",
  status: 400,
  title: "Push receipt not found",
  suggestion: "Run: veryfront push --branch main first",
});

export const SOURCE_DIGEST_MISMATCH = defineError({
  slug: "source-digest-mismatch",
  category: "DEPLOY",
  status: 409,
  title: "Release source digest mismatch",
  suggestion: "Run veryfront push again to re-upload source files",
});

export const PREVIEW_HOSTNAME_TOO_LONG = defineError({
  slug: "preview-hostname-too-long",
  category: "DEPLOY",
  status: 400,
  title: "Preview hostname too long",
  suggestion: "Use a shorter project slug or branch name",
});

export const BRANCH_NOT_FOUND = defineError({
  slug: "branch-not-found",
  category: "DEPLOY",
  status: 404,
  title: "Branch not found",
  suggestion: "List branches in Studio or push a new one with: veryfront push --branch <name>",
});

/**
 * The project's configuration file uses a construct Veryfront Cloud's
 * configuration evaluator can never accept, so the release would answer 500 to
 * every request. Raised before a release is created; the detail names the file,
 * the change that makes the project deployable, and the line when the evaluator
 * located the construct it refused.
 */
export const CONFIG_NOT_DEPLOYABLE = defineError({
  slug: "config-not-deployable",
  category: "DEPLOY",
  status: 400,
  title: "Configuration cannot be deployed to Veryfront Cloud",
  suggestion:
    "Veryfront Cloud reads veryfront.config.ts as data: keep it to literals and the veryfront configuration helpers",
  exitCode: 2,
});

/** Registry fragment for DEPLOY errors (slug → definition). */
export const DEPLOY_REGISTRY = {
  "config-not-deployable": CONFIG_NOT_DEPLOYABLE,
  "deployment-error": DEPLOYMENT_ERROR,
  "platform-error": PLATFORM_ERROR,
  "env-var-missing": ENV_VAR_MISSING,
  "production-build-required": PRODUCTION_BUILD_REQUIRED,
  "environment-not-found": ENVIRONMENT_NOT_FOUND,
  "environment-not-routable": ENVIRONMENT_NOT_ROUTABLE,
  "release-missing-version": RELEASE_MISSING_VERSION,
  "release-build-timeout": RELEASE_BUILD_TIMEOUT,
  "deployment-verification-timeout": DEPLOYMENT_VERIFICATION_TIMEOUT,
  "push-receipt-missing": PUSH_RECEIPT_MISSING,
  "source-digest-mismatch": SOURCE_DIGEST_MISMATCH,
  "preview-hostname-too-long": PREVIEW_HOSTNAME_TOO_LONG,
  "branch-not-found": BRANCH_NOT_FOUND,
} as const;
