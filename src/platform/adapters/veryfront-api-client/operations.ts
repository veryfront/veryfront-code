import { logger as baseLogger } from "#veryfront/utils";
import { z } from "zod";
import { type RequestOptions, requestWithRetry, type RetryConfig } from "./retry-handler.ts";
import { API_CLIENT_ERROR } from "./types.ts";
import {
  BranchFileDetailSchema,
  EnvironmentFileDetailSchema,
  ListBranchFilesResponseSchema,
  ListEnvironmentFilesResponseSchema,
  ListProjectsResponseSchema,
  ListReleaseFilesResponseSchema,
  type LookupDomainResponse,
  type PageInfo,
  type Project,
  type ProjectFile,
  ProjectSchema,
  ReleaseFileDetailSchema,
  StyleArtifactResolveResponseSchema,
} from "./schemas/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

const logger = baseLogger.component("api");

const DEFAULT_PAGE_LIMIT = 100;

export type TokenProvider = () => string;

export interface ListFilesOptions {
  cursor?: string;
  limit?: number;
  pattern?: string;
  sortBy?: "path" | "updated_at";
  sortOrder?: "asc" | "desc";
}

export interface FileListResult {
  files: ProjectFile[];
  page_info: PageInfo;
  release_id?: string;
  release_version?: string | null;
  environment_id?: string;
  environment_name?: string;
}

export interface FileDetail {
  path: string;
  content: string;
  id?: string;
  version_id?: string;
  type?: string;
  size?: number;
  release_id?: string;
  release_version?: string | null;
}

export interface StyleArtifactSelector {
  branch?: string;
  environmentName?: string;
  releaseId?: string;
}

export interface ResolveStyleArtifactInput extends StyleArtifactSelector {
  styleProfileHash: string;
}

export interface UpsertStyleArtifactInput extends ResolveStyleArtifactInput {
  artifactHash: string;
  assetPath?: string;
  contentType?: string;
  etag?: string;
}

export interface ProjectStyleArtifactResolution {
  status: "ready" | "missing";
  artifactHash?: string;
  assetPath?: string;
  etag?: string;
  contentType?: string;
  updatedAt?: string;
}

function buildListParams(options: ListFilesOptions): URLSearchParams {
  const { cursor, limit = DEFAULT_PAGE_LIMIT, pattern, sortBy = "updated_at", sortOrder = "desc" } =
    options;

  const params = new URLSearchParams({
    limit: String(limit),
    sort_by: sortBy,
    sort_order: sortOrder,
  });

  if (cursor) params.set("cursor", cursor);
  if (pattern) params.set("pattern", pattern);

  return params;
}

function mapProjectFile<T extends ProjectFile>(file: T): ProjectFile {
  return {
    id: file.id,
    version_id: file.version_id,
    path: file.path,
    content: file.content,
    type: file.type,
    size: file.size,
    updated_at: file.updated_at,
  };
}

function buildStyleArtifactParams(input: ResolveStyleArtifactInput): URLSearchParams {
  const params = new URLSearchParams({
    style_profile_hash: input.styleProfileHash,
  });

  if (input.branch) params.set("branch", input.branch);
  if (input.environmentName) params.set("environment_name", input.environmentName);
  if (input.releaseId) params.set("release_id", input.releaseId);

  return params;
}

function mapStyleArtifactResolution(raw: unknown): ProjectStyleArtifactResolution {
  const response = StyleArtifactResolveResponseSchema.parse(raw);
  return {
    status: response.status,
    artifactHash: response.artifact_hash,
    assetPath: response.asset_path,
    etag: response.etag,
    contentType: response.content_type,
    updatedAt: response.updated_at,
  };
}

async function listAllFiles(
  list: (cursor?: string) => Promise<FileListResult>,
): Promise<ProjectFile[]> {
  const allFiles: ProjectFile[] = [];
  let cursor: string | undefined;

  do {
    const result = await list(cursor);
    allFiles.push(...result.files);
    cursor = result.page_info.next ?? undefined;
  } while (cursor);

  return allFiles;
}

export class VeryfrontAPIOperations {
  private tokenProvider: TokenProvider;

  constructor(
    private apiBaseUrl: string,
    tokenOrProvider: string | TokenProvider,
    private retryConfig: RetryConfig,
    private projectId?: string,
  ) {
    this.tokenProvider = typeof tokenOrProvider === "string"
      ? () => tokenOrProvider
      : tokenOrProvider;
  }

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  getToken(): string {
    return this.tokenProvider();
  }

  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string {
    if (this.projectId) return this.projectId;

    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API client not initialized. Call initialize() with a project ID first.",
    });
  }

  async listProjects(options?: {
    search?: string;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }): Promise<Project[]> {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.sortBy) params.set("sort_by", options.sortBy);
    if (options?.sortOrder) params.set("sort_order", options.sortOrder);

    const query = params.toString();
    const raw = await this.request(query ? `/projects?${query}` : "/projects");
    return ListProjectsResponseSchema.parse(raw).data;
  }

  async getProject(projectRef: string): Promise<Project> {
    const raw = await this.request(`/projects/${encodeURIComponent(projectRef)}`);
    return ProjectSchema.parse(raw);
  }

  async listBranchFiles(
    projectRef: string,
    branchRef = "main",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    params.set("branch", branchRef);
    const url = `/projects/${encodeURIComponent(projectRef)}/files?${params}`;
    logger.debug("listBranchFiles", { projectRef, branchRef, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListBranchFilesResponseSchema.parse(raw);

    return {
      files: response.data.map(mapProjectFile),
      page_info: response.page_info,
    };
  }

  async listAllBranchFiles(
    projectRef: string,
    branchRef = "main",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles = await listAllFiles((cursor) =>
      this.listBranchFiles(projectRef, branchRef, {
        ...options,
        cursor,
        limit: DEFAULT_PAGE_LIMIT,
      })
    );

    logger.debug("listAllBranchFiles DONE", {
      projectRef,
      branchRef,
      totalFiles: allFiles.length,
    });

    return allFiles;
  }

  getBranchFile(projectRef: string, branchRef: string, pathOrId: string): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = new URLSearchParams({ branch: branchRef });
        const url = `/projects/${encodeURIComponent(projectRef)}/files/${
          encodeURIComponent(pathOrId)
        }?${params}`;
        logger.debug("getBranchFile", { projectRef, branchRef, pathOrId });

        const raw = await this.request(url);
        const response = BranchFileDetailSchema.parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          type: response.type,
          size: response.size,
        };
      },
      {
        "api.operation": "getBranchFile",
        "api.project": projectRef,
        "api.branch": branchRef,
        "api.path": pathOrId,
      },
    );
  }

  async listEnvironmentFiles(
    projectRef: string,
    environmentName = "production",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
      encodeURIComponent(environmentName)
    }/files?${params}`;
    logger.debug("listEnvironmentFiles", {
      projectRef,
      environmentName,
      pattern: options.pattern,
    });

    const raw = await this.request(url);
    const response = ListEnvironmentFilesResponseSchema.parse(raw);

    return {
      files: response.data.map(mapProjectFile),
      page_info: response.page_info,
      release_id: response.release_id,
      release_version: response.release_version,
      environment_id: response.environment_id,
      environment_name: response.environment_name,
    };
  }

  async listAllEnvironmentFiles(
    projectRef: string,
    environmentName = "production",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles = await listAllFiles((cursor) =>
      this.listEnvironmentFiles(projectRef, environmentName, {
        ...options,
        cursor,
        limit: DEFAULT_PAGE_LIMIT,
      })
    );

    logger.debug("listAllEnvironmentFiles", {
      projectRef,
      environmentName,
      totalFiles: allFiles.length,
    });

    return allFiles;
  }

  getEnvironmentFile(
    projectRef: string,
    environmentName: string,
    pathOrId: string,
  ): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
          encodeURIComponent(environmentName)
        }/files/${encodeURIComponent(pathOrId)}`;
        logger.debug("getEnvironmentFile", { projectRef, environmentName, pathOrId });

        const raw = await this.request(url);
        const response = EnvironmentFileDetailSchema.parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          release_id: response.release_id,
          release_version: response.release_version,
        };
      },
      {
        "api.operation": "getEnvironmentFile",
        "api.project": projectRef,
        "api.environment": environmentName,
        "api.path": pathOrId,
      },
    );
  }

  async listReleaseFiles(
    projectRef: string,
    version = "latest",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/files?${params}`;
    logger.debug("listReleaseFiles", { projectRef, version, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListReleaseFilesResponseSchema.parse(raw);

    return {
      files: response.data.map(mapProjectFile),
      page_info: response.page_info,
      release_id: response.release_id,
      release_version: response.release_version,
    };
  }

  async listAllReleaseFiles(
    projectRef: string,
    version = "latest",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    return listAllFiles((cursor) =>
      this.listReleaseFiles(projectRef, version, { ...options, cursor, limit: DEFAULT_PAGE_LIMIT })
    );
  }

  getReleaseFile(projectRef: string, version: string, pathOrId: string): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
          encodeURIComponent(version)
        }/files/${encodeURIComponent(pathOrId)}`;
        logger.debug("getReleaseFile", { projectRef, version, pathOrId });

        const raw = await this.request(url);
        const response = ReleaseFileDetailSchema.parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          release_id: response.release_id,
          release_version: response.release_version,
        };
      },
      {
        "api.operation": "getReleaseFile",
        "api.project": projectRef,
        "api.version": version,
        "api.path": pathOrId,
      },
    );
  }

  lookupProjectByDomain(domain: string): Promise<LookupDomainResponse | null> {
    return withSpan(
      SpanNames.API_DOMAIN_LOOKUP,
      async () => {
        const domainWithoutPort = domain.replace(/:\d+$/, "");
        const url = `/projects/${encodeURIComponent(domainWithoutPort)}`;
        logger.debug("lookupProjectByDomain", { domain });

        try {
          const raw = await this.request(url);
          const project = ProjectSchema.extend({
            environments: z
              .array(
                z.object({
                  id: z.string().uuid(),
                  name: z.string(),
                  domains: z.array(z.string()).optional(),
                  active_release_id: z.string().uuid().nullable().optional(),
                }),
              )
              .optional(),
          }).parse(raw);

          const matchingEnv = project.environments?.find((env) =>
            env.domains?.some((d) => d.toLowerCase() === domainWithoutPort.toLowerCase())
          );

          const response: LookupDomainResponse = {
            project_id: project.id,
            project_slug: project.slug,
            project_name: project.name,
            environment: matchingEnv ? { id: matchingEnv.id, name: matchingEnv.name } : null,
            release_id: matchingEnv?.active_release_id ?? null,
          };

          logger.debug("Domain lookup result", {
            domain,
            projectSlug: response.project_slug,
            environment: response.environment?.name,
          });

          return response;
        } catch (error) {
          if (error instanceof Error && error.message.includes("404")) {
            logger.debug("No project found for domain", { domain });
            return null;
          }
          throw error;
        }
      },
      { "api.domain": domain },
    );
  }

  async resolveStyleArtifact(
    projectRef: string,
    input: ResolveStyleArtifactInput,
  ): Promise<ProjectStyleArtifactResolution> {
    const params = buildStyleArtifactParams(input);
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current?${params}`;
    logger.debug("resolveStyleArtifact", {
      projectRef,
      branch: input.branch,
      environmentName: input.environmentName,
      releaseId: input.releaseId,
      styleProfileHash: input.styleProfileHash,
    });

    return mapStyleArtifactResolution(await this.request(url));
  }

  async upsertStyleArtifact(
    projectRef: string,
    input: UpsertStyleArtifactInput,
  ): Promise<ProjectStyleArtifactResolution> {
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current`;
    logger.debug("upsertStyleArtifact", {
      projectRef,
      branch: input.branch,
      environmentName: input.environmentName,
      releaseId: input.releaseId,
      styleProfileHash: input.styleProfileHash,
      artifactHash: input.artifactHash,
    });

    return mapStyleArtifactResolution(
      await this.request(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style_profile_hash: input.styleProfileHash,
          branch: input.branch,
          environment_name: input.environmentName,
          release_id: input.releaseId,
          artifact_hash: input.artifactHash,
          asset_path: input.assetPath,
          content_type: input.contentType,
          etag: input.etag,
        }),
      }),
    );
  }

  private request(endpoint: string, options: RequestOptions = {}): Promise<unknown> {
    return withSpan(
      SpanNames.API_REQUEST,
      () =>
        requestWithRetry(
          `${this.apiBaseUrl}${endpoint}`,
          this.tokenProvider(),
          this.retryConfig,
          options,
        ),
      { "api.endpoint": endpoint, "api.base_url": this.apiBaseUrl },
    );
  }
}
