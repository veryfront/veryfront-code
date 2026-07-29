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
  resolvePushedSource,
  verifyDeployment,
  verifyReleaseSource,
  waitForEnvironmentReady,
  waitForReleaseAssetManifest,
} from "./command.ts";
export type {
  Deployment,
  DeploymentRoutingConvergence,
  DeploymentVerification,
  DeployOptions,
  DeployResult,
  EnvironmentReadinessOptions,
  EnvironmentReadinessTarget,
  ReleaseSourceVerification,
} from "./command.ts";
export { handleDeployCommand } from "./handler.ts";
