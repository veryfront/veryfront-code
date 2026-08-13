import type { DeploymentRoutingConvergence } from "./control-plane.ts";

export interface DeployResult {
  projectId: string;
  projectSlug: string;
  release: {
    id: string;
    name: string;
    version: string;
  };
  environment: string;
  environmentId: string;
  deploymentId: string;
  url: string;
  /**
   * What the readiness step established about {@link DeployResult.url}.
   *
   * `served` means the probe saw the app answer. `gated` means only the access
   * gate answered, so the app behind it was never observed. That value is the
   * machine-readable form of the `environment-url-unverified` warning, for CI
   * that needs to fail on it. `unprobed` means the project has no page route to
   * check.
   */
  urlVerification: "served" | "gated" | "unprobed";
  protected: boolean;
  routingConvergence: DeploymentRoutingConvergence | null;
  commitSha: string | null;
  sourceDigest: string;
  controlPlane: string;
  branch: string;
}
