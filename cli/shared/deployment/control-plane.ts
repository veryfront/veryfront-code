import type { ApiClient, ResolvedConfig } from "#cli/shared/config";
import { createApiClient } from "#cli/shared/config";
import {
  getProjectTarget,
  normalizeControlPlane,
  type ProjectTarget,
} from "../deployment-provenance.ts";
import { DEPLOYMENT_ERROR } from "veryfront/errors";

export interface DeployProjectRecord {
  id: string;
  slug: string;
}

export interface DeployEnvironment {
  id: string;
  name: string;
  protected: boolean;
  projectId?: string;
  deployment?: {
    id: string;
    release: { id: string; name: string | null } | null;
  } | null;
  domains?: string[];
}

export interface DeployRelease {
  id: string;
  name: string;
  version: string | null;
  projectId?: string;
}

export type DeploymentRoutingConvergence =
  | { status: "converged"; acknowledged: number; recipients: number }
  | { status: "pending" }
  | { status: "skipped" };

export interface DeployDeployment {
  id: string;
  releaseId: string;
  environmentId: string;
  routingConvergence?: DeploymentRoutingConvergence;
}

export interface DeployReleaseFile {
  path: string;
  content: string;
}

export type DeployReleaseAssetManifestBody = object | string | number | boolean;

export interface DeployReleaseAssetManifestReadOptions {
  signal?: AbortSignal;
}

export interface DeployControlPlane {
  readonly controlPlane: string;
  getProject(reference: string): Promise<DeployProjectRecord>;
  getEnvironment(reference: string, name: string): Promise<DeployEnvironment | null>;
  createRelease(
    reference: string,
    input: { name?: string; branch: string },
  ): Promise<DeployRelease>;
  getRelease(reference: string, releaseId: string): Promise<DeployRelease>;
  listReleaseFiles(
    reference: string,
    releaseId: string,
  ): AsyncIterable<DeployReleaseFile>;
  /**
   * Performs one manifest read and returns null only while it does not exist.
   * The caller owns polling and retry timing.
   */
  getReleaseAssetManifest(
    projectSlug: string,
    releaseId: string,
    options?: DeployReleaseAssetManifestReadOptions,
  ): Promise<DeployReleaseAssetManifestBody | null>;
  createDeployment(
    reference: string,
    input: { releaseId: string; environmentId: string },
  ): Promise<DeployDeployment>;
  getDeployment(reference: string, deploymentId: string): Promise<DeployDeployment>;
  /**
   * Exchanges the stored API key for a short-lived token bound to one protected
   * environment. The API authorizes the key for that target and refuses the
   * token as a session.
   */
  createEnvironmentAccessToken(
    target: EnvironmentAccessTarget,
  ): Promise<EnvironmentAccessToken>;
}

export interface EnvironmentAccessTarget {
  projectId: string;
  environmentName: string;
}

export interface EnvironmentAccessToken {
  accessToken: string;
  expiresIn: number;
}

interface WireEnvironmentAccessToken {
  access_token: string;
  expires_in: number;
}

interface WireEnvironmentDeployment {
  id: string;
  release: {
    id: string;
    name: string | null;
  } | null;
}

interface WireEnvironment {
  id: string;
  name: string;
  protected: boolean;
  project_id?: string;
  project?: string | { id: string };
  projectId?: string;
  deployment?: WireEnvironmentDeployment | null;
  domains?: string[];
}

interface WireRelease {
  id: string;
  name: string;
  version: string | null;
  project_id?: string;
  project?: string | { id: string };
  projectId?: string;
  export_status?: string;
  build_status?: string;
  deploy_status?: string;
}

interface WireDeployment {
  id: string;
  release_id?: string;
  environment_id?: string;
  release?: string | { id: string };
  environment?: string | { id: string };
  routing_convergence?: DeploymentRoutingConvergence;
}

interface ListEnvironmentsResponse {
  data: WireEnvironment[];
  page_info?: {
    next?: string;
  };
}

interface ReleaseFileVersion {
  path: string;
  content?: unknown;
  data?: unknown;
}

interface ListReleaseVersionsResponse {
  data: ReleaseFileVersion[];
  page_info?: {
    next?: string;
  };
}

function referenceId(value: string | { id: string } | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function normalizeProject(project: ProjectTarget): DeployProjectRecord {
  return { id: project.id, slug: project.slug };
}

function normalizeEnvironment(environment: WireEnvironment): DeployEnvironment {
  const projectId = environment.project_id ?? environment.projectId ??
    referenceId(environment.project);
  return {
    id: environment.id,
    name: environment.name,
    protected: environment.protected,
    ...(projectId ? { projectId } : {}),
    ...(environment.deployment !== undefined ? { deployment: environment.deployment } : {}),
    ...(environment.domains ? { domains: environment.domains } : {}),
  };
}

function normalizeRelease(release: WireRelease): DeployRelease {
  const projectId = release.project_id ?? release.projectId ?? referenceId(release.project);
  return {
    id: release.id,
    name: release.name,
    version: release.version,
    ...(projectId ? { projectId } : {}),
  };
}

function normalizeDeployment(deployment: WireDeployment): DeployDeployment {
  const releaseId = deployment.release_id ?? referenceId(deployment.release);
  const environmentId = deployment.environment_id ?? referenceId(deployment.environment);
  if (!releaseId || !environmentId) {
    throw DEPLOYMENT_ERROR.create({
      detail: `Deployment ${deployment.id} response is missing release or environment IDs`,
    });
  }
  return {
    id: deployment.id,
    releaseId,
    environmentId,
    ...(deployment.routing_convergence
      ? { routingConvergence: deployment.routing_convergence }
      : {}),
  };
}

function getReleaseFileContent(file: ReleaseFileVersion): string {
  const content = typeof file.content === "string" ? file.content : undefined;
  let legacyBody: string | undefined;

  if (typeof file.data === "string") {
    let envelope: unknown;
    try {
      envelope = JSON.parse(file.data);
    } catch {
      throw new Error(`Release file ${file.path} has invalid version data`);
    }
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
      throw new Error(`Release file ${file.path} has invalid version data`);
    }

    const record = envelope as Record<string, unknown>;
    if (typeof record.body !== "string") {
      throw new Error(`Release file ${file.path} version data has no body`);
    }
    if (typeof record.path === "string" && record.path !== file.path) {
      throw new Error(`Release file ${file.path} version data references ${record.path}`);
    }
    legacyBody = record.body;
  }

  if (content !== undefined && legacyBody !== undefined && content !== legacyBody) {
    throw new Error(`Release file ${file.path} has conflicting content fields`);
  }
  const value = content ?? legacyBody;
  if (value === undefined) throw new Error(`Release file ${file.path} has no content`);
  return value;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function createHttpDeployControlPlane(
  config: ResolvedConfig,
  client: ApiClient = createApiClient(config),
): DeployControlPlane {
  return {
    controlPlane: normalizeControlPlane(config.apiUrl),

    async getProject(reference) {
      return normalizeProject(await getProjectTarget(client, reference));
    },

    async getEnvironment(reference, name) {
      let cursor: string | undefined;

      do {
        const params: Record<string, string> = { limit: "100" };
        if (cursor) params.cursor = cursor;

        const response = await client.get<ListEnvironmentsResponse>(
          `/projects/${reference}/environments`,
          params,
        );

        const found = response.data.find((environment) => environment.name === name);
        if (found) return normalizeEnvironment(found);

        cursor = response.page_info?.next;
      } while (cursor);

      return null;
    },

    async createRelease(reference, input) {
      const body: Record<string, string> = {};
      if (input.name) body.name = input.name;
      if (input.branch) body.branch_reference = input.branch;
      return normalizeRelease(
        await client.post<WireRelease>(`/projects/${reference}/releases`, body),
      );
    },

    async getRelease(reference, releaseId) {
      return normalizeRelease(
        await client.get<WireRelease>(`/projects/${reference}/releases/${releaseId}`),
      );
    },

    async *listReleaseFiles(reference, releaseId) {
      let cursor: string | undefined;

      do {
        const params: Record<string, string> = { limit: "100" };
        if (cursor) params.cursor = cursor;
        const response = await client.get<ListReleaseVersionsResponse>(
          `/projects/${reference}/releases/${releaseId}/versions`,
          params,
        );
        for (const file of response.data) {
          yield { path: file.path, content: getReleaseFileContent(file) };
        }
        cursor = response.page_info?.next;
      } while (cursor);
    },

    async getReleaseAssetManifest(projectSlug, releaseId, options) {
      let response: unknown;
      try {
        response = await client.get<unknown>(
          `/projects/${projectSlug}/releases/${releaseId}/asset-manifest`,
          undefined,
          { retryPolicy: "none", signal: options?.signal },
        );
      } catch (error) {
        if (getErrorStatus(error) === 404) return null;
        throw error;
      }
      if (response == null) {
        throw new Error(`Release assets for ${releaseId} returned an empty manifest response`);
      }
      return response as DeployReleaseAssetManifestBody;
    },

    async createDeployment(reference, input) {
      return normalizeDeployment(
        await client.post<WireDeployment>(`/projects/${reference}/deployments`, {
          release_id: input.releaseId,
          environment_id: input.environmentId,
        }),
      );
    },

    async getDeployment(reference, deploymentId) {
      return normalizeDeployment(
        await client.get<WireDeployment>(`/projects/${reference}/deployments/${deploymentId}`),
      );
    },

    async createEnvironmentAccessToken(target) {
      const response = await client.post<WireEnvironmentAccessToken>("/auth/environment-token", {
        project_reference: target.projectId,
        environment_name: target.environmentName,
      });
      const token = response?.access_token;
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("The API did not return an environment access token");
      }
      const expiresIn = response?.expires_in;
      if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) {
        throw new Error("The API did not return a positive integer expiry");
      }
      return { accessToken: token, expiresIn };
    },
  };
}
