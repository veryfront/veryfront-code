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

/**
 * Source published to an environment that renders a branch live.
 *
 * Veryfront's managed Preview environment serves the latest source on main
 * directly, so publishing there is a push followed by a readiness probe. No
 * release or deployment exists, which is why this result carries neither.
 */
export interface LiveSourceResult {
  projectId: string;
  projectSlug: string;
  environment: string;
  environmentId: string;
  url: string;
  /**
   * What the readiness probe established about {@link LiveSourceResult.url}.
   *
   * `responded` means the Preview URL answered with the app, not that it
   * answered with the source just pushed: a replica can still serve the
   * previous source for a moment. `gated` and `unprobed` mean the same as in
   * {@link DeployResult.urlVerification}.
   *
   * TODO(veryfront/veryfront-issue-inbox#1457): once Preview exposes the
   * revision it serves, confirm it matches `sourceDigest` and report that
   * instead of a bare response.
   */
  urlVerification: "responded" | "gated" | "unprobed";
  protected: boolean;
  commitSha: string | null;
  sourceDigest: string;
  controlPlane: string;
  branch: string;
}
