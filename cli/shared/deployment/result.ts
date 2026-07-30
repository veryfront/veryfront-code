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
  protected: boolean;
  routingConvergence: DeploymentRoutingConvergence | null;
  commitSha: string | null;
  sourceDigest: string;
  controlPlane: string;
  branch: string;
}
