import { logger } from "#veryfront/utils";
import { z } from "zod";
import { requestWithRetry, type RetryConfig } from "./retry-handler.ts";
import { VeryfrontAPIError } from "./types.ts";
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
} from "./schemas.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

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

function buildListParams(options: ListFilesOptions): URLSearchParams {
  const { cursor, limit = 100, pattern, sortBy = "updated_at", sortOrder = "desc" } = options;

  const params = new URLSearchParams({
    limit: String(limit),
    sort_by: sortBy,
    sort_order: sortOrder,
  });

  if (cursor) params.set("cursor", cursor);
  if (pattern) params.set("pattern", pattern);

  return params;
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

    throw new VeryfrontAPIError(
      "Veryfront API client not initialized. Call initialize() with a project ID first.",
    );
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
    branchName = "main",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/branches/${
      encodeURIComponent(branchName)
    }/files?${params}`;
    logger.debug("[API] listBranchFiles", { projectRef, branchName, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListBranchFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updated_at: f.updated_at,
      })),
      page_info: response.page_info,
    };
  }

  async listAllBranchFiles(
    projectRef: string,
    branchName = "main",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listBranchFiles(projectRef, branchName, {
        ...options,
        cursor,
        limit: 100,
      });
      allFiles.push(...result.files);
      cursor = result.page_info.next ?? undefined;
    } while (cursor);

    return allFiles;
  }

  getBranchFile(
    projectRef: string,
    branchName: string,
    pathOrId: string,
  ): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const url = `/projects/${encodeURIComponent(projectRef)}/branches/${
          encodeURIComponent(branchName)
        }/files/${encodeURIComponent(pathOrId)}`;
        logger.debug("[API] getBranchFile", { projectRef, branchName, pathOrId });

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
        "api.branch": branchName,
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
    logger.debug("[API] listEnvironmentFiles", {
      projectRef,
      environmentName,
      pattern: options.pattern,
    });

    const raw = await this.request(url);
    const response = ListEnvironmentFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        version_id: f.version_id,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updated_at: f.updated_at,
      })),
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
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listEnvironmentFiles(projectRef, environmentName, {
        ...options,
        cursor,
        limit: 100,
      });
      allFiles.push(...result.files);
      cursor = result.page_info.next ?? undefined;
    } while (cursor);

    logger.debug("[API] listAllEnvironmentFiles", {
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
        logger.debug("[API] getEnvironmentFile", { projectRef, environmentName, pathOrId });

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
    logger.debug("[API] listReleaseFiles", { projectRef, version, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListReleaseFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        version_id: f.version_id,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updated_at: f.updated_at,
      })),
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
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listReleaseFiles(projectRef, version, {
        ...options,
        cursor,
        limit: 100,
      });
      allFiles.push(...result.files);
      cursor = result.page_info.next ?? undefined;
    } while (cursor);

    return allFiles;
  }

  getReleaseFile(projectRef: string, version: string, pathOrId: string): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
          encodeURIComponent(version)
        }/files/${encodeURIComponent(pathOrId)}`;
        logger.debug("[API] getReleaseFile", { projectRef, version, pathOrId });

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
        logger.debug("[API] lookupProjectByDomain", { domain });

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

          logger.debug("[API] Domain lookup result", {
            domain,
            projectSlug: response.project_slug,
            environment: response.environment?.name,
          });

          return response;
        } catch (error) {
          if (error instanceof Error && error.message.includes("404")) {
            logger.debug("[API] No project found for domain", { domain });
            return null;
          }
          throw error;
        }
      },
      { "api.domain": domain },
    );
  }

  private request(endpoint: string): Promise<unknown> {
    return withSpan(
      SpanNames.API_REQUEST,
      () => {
        const url = `${this.apiBaseUrl}${endpoint}`;
        return requestWithRetry(url, this.tokenProvider(), this.retryConfig);
      },
      { "api.endpoint": endpoint, "api.base_url": this.apiBaseUrl },
    );
  }
}
