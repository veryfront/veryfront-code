/**
 * Human progress text for Deploy Execution step events.
 *
 * Shared by every presentation adapter that renders `DeployProject.execute`
 * progress (the deploy command, `veryfront up`) so the same step always reads
 * the same way.
 *
 * @module cli/shared/deployment/progress
 */

import type { DeployEvent, DeployStepName } from "./deploy-project.ts";

/** Text a spinner should show for a step event, or null when nothing changes. */
export function deployProgressText(
  event: Extract<DeployEvent, { kind: "step" }>,
  environment: string,
  verbose: boolean,
): string | null {
  if (event.phase !== "started") return null;
  switch (event.step) {
    case "resolve-config":
      return verbose ? "Resolving configuration..." : "Linking project...";
    case "push-source":
      return verbose ? "Pushing source..." : "Uploading source...";
    case "resolve-target":
    case "verify-source":
    case "create-release":
    case "verify-release-source":
    case "wait-release-assets":
      return verbose ? buildStepDetail(event.step, environment) : "Building release...";
    case "create-deployment":
      return `Deploying to ${environment}...`;
    case "verify-deployment":
      return verbose ? `Verifying ${environment} deployment...` : `Deploying to ${environment}...`;
    case "wait-environment-url":
      return verbose ? `Waiting for ${environment} URL...` : `Verifying ${environment} URL...`;
  }
}

/** First line a spinner shows before Deploy Execution emits its first step. */
export function initialDeployProgressText(verbose: boolean): string {
  return verbose ? "Resolving configuration..." : "Linking project...";
}

function buildStepDetail(stepName: DeployStepName, environment: string): string {
  switch (stepName) {
    case "resolve-target":
      return `Looking up environment "${environment}"...`;
    case "verify-source":
      return "Verifying pushed source...";
    case "create-release":
      return "Creating release...";
    case "verify-release-source":
      return "Verifying release source...";
    case "wait-release-assets":
      return "Waiting for release assets...";
    default:
      return "Building release...";
  }
}
