/**
 * Deploy command - Create and deploy releases
 */

export {
  assertProjectOwnership,
  createDeployment,
  createRelease,
  DeployArgsSchema,
  deployCommand,
  getDeployment,
  getDeploymentRoutingConvergenceWarning,
  getEnvironmentByName,
  getProject,
  getRelease,
  getReleaseSourceDigest,
  parseDeployArgs,
  requiresExplicitDeployConfirmation,
  resolvePushedSource,
  verifyDeployment,
  verifyReleaseSource,
  waitForReleaseAssetManifest,
} from "./command.ts";
export type {
  Deployment,
  DeploymentRoutingConvergence,
  DeploymentVerification,
  DeployOptions,
  ReleaseSourceVerification,
} from "./command.ts";
export { handleDeployCommand } from "./handler.ts";
