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
  getEnvironmentByName,
  getProject,
  getRelease,
  getReleaseSourceDigest,
  parseDeployArgs,
  resolvePushedSource,
  verifyDeployment,
  verifyReleaseSource,
} from "./command.ts";
export type {
  DeploymentVerification,
  DeployOptions,
  ReleaseSourceVerification,
} from "./command.ts";
export { handleDeployCommand } from "./handler.ts";
