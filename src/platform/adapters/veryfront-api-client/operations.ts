import { logger as baseLogger } from "#veryfront/utils";
import {
  createCanonicalVeryfrontApiTransport,
  type TransportRequestInit,
  type TransportRetryConfig,
  type VeryfrontApiTransport,
} from "../veryfront-api-transport.ts";
import { API_CLIENT_ERROR, VeryfrontError } from "./types.ts";
import {
  getBranchFileDetailSchema,
  getEnvironmentFileDetailSchema,
  getListBranchFilesResponseSchema,
  getListEnvironmentFilesResponseSchema,
  getListProjectsResponseSchema,
  getListReleaseFilesResponseSchema,
  getProjectSchema,
  getProjectWithEnvironmentsSchema,
  getReleaseAssetManifestBuildResponseSchema,
  getReleaseAssetManifestResponseSchema,
  getReleaseAssetManifestStateResponseSchema,
  getReleaseAssetUploadResponseSchema,
  getReleaseFileDetailSchema,
  getStyleArtifactResolveResponseSchema,
  type LookupDomainResponse,
  type PageInfo,
  type Project,
  type ProjectFile,
  type ReleaseAssetManifestApiResponse,
  type ReleaseAssetManifestBuildResponse,
  type ReleaseAssetManifestStateResponse,
  type ReleaseAssetUploadResponse,
} from "./schemas/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

const logger = baseLogger.component("api");

const DEFAULT_PAGE_LIMIT = 100;
const MAX_LIST_ALL_PAGES = 10_000;
const MAX_DOMAIN_CODE_UNITS = 253;
const MAX_DOMAIN_INPUT_CODE_UNITS = MAX_DOMAIN_CODE_UNITS + 8;

export type TokenProvider = () => string;

export interface ListFilesOptions {
  cursor?: string;
  limit?: number;
  path?: string;
  pattern?: string;
  signal?: AbortSignal;
  sortBy?: "path" | "updated_at";
  sortOrder?: "asc" | "desc";
}

export interface ListProjectsOptions {
  search?: string;
  limit?: number;
  sortBy?: string;
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
  type: ProjectFile["type"];
  size: number;
  updated_at: string;
  id?: string;
  version_id?: string;
  release_id?: string;
  release_version?: string | null;
}

export interface GetFileOptions {
  /** True when the caller is probing an optional candidate and expects a possible 404. */
  expectedMissing?: boolean;
}

export interface StyleArtifactSelector {
  branch?: string;
  environmentName?: string;
  releaseId?: string;
}

export interface ResolveStyleArtifactInput extends StyleArtifactSelector {
  styleProfileHash: string;
}

export interface EnsureStyleArtifactBuildInput extends ResolveStyleArtifactInput {
  force?: boolean;
}

export interface UpsertStyleArtifactInput extends ResolveStyleArtifactInput {
  status?: "building" | "ready" | "failed";
  artifactHash?: string;
  assetPath?: string;
  contentType?: string;
  etag?: string;
  buildRunId?: string;
  failureReason?: string;
}

export interface ProjectStyleArtifactResolution {
  status: "ready" | "missing" | "building" | "failed";
  artifactHash?: string;
  assetPath?: string;
  etag?: string;
  contentType?: string;
  buildRunId?: string;
  failureReason?: string;
  updatedAt?: string;
}

function buildListParams(options: ListFilesOptions): URLSearchParams {
  const {
    cursor,
    limit = DEFAULT_PAGE_LIMIT,
    path,
    pattern,
    sortBy = "updated_at",
    sortOrder = "desc",
  } = options;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_LIMIT) {
    throw API_CLIENT_ERROR.create({
      detail: `File-list limit must be an integer between 1 and ${DEFAULT_PAGE_LIMIT}`,
      status: 400,
    });
  }

  const params = new URLSearchParams({
    limit: String(limit),
    sort_by: sortBy,
    sort_order: sortOrder,
  });

  if (cursor) params.set("cursor", cursor);
  if (path) params.set("path", path);
  if (pattern) params.set("pattern", pattern);

  return params;
}

function addRuntimeServerFunctionAccess(params: URLSearchParams): URLSearchParams {
  params.set("include_server_functions", "true");
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
  const response = getStyleArtifactResolveResponseSchema().parse(raw);
  return {
    status: response.status,
    artifactHash: response.artifact_hash,
    assetPath: response.asset_path,
    etag: response.etag,
    contentType: response.content_type,
    buildRunId: response.build_run_id,
    failureReason: response.failure_reason,
    updatedAt: response.updated_at,
  };
}

function normalizeLookupDomain(
  value: string,
  source: "request" | "upstream",
): string {
  const status = source === "request" ? 400 : 502;
  const detail = source === "request"
    ? "Domain lookup requires a valid bounded host"
    : "Veryfront API returned an invalid environment domain";
  const fail = (): never => {
    throw API_CLIENT_ERROR.create({ detail, status });
  };

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DOMAIN_INPUT_CODE_UNITS ||
    value !== value.trim() ||
    /[\p{Cc}\s/@?#]/u.test(value)
  ) {
    return fail();
  }

  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.hostname.length === 0 ||
      parsed.hostname.length > MAX_DOMAIN_CODE_UNITS
    ) {
      return fail();
    }

    const normalized = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    return normalized.length > 0 ? normalized : fail();
  } catch {
    return fail();
  }
}

async function listAllFiles(
  list: (cursor?: string) => Promise<FileListResult>,
): Promise<ProjectFile[]> {
  const allFiles: ProjectFile[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_LIST_ALL_PAGES; page++) {
    const result = await list(cursor);
    allFiles.push(...result.files);
    const nextCursor = result.page_info.next ?? undefined;
    if (!nextCursor) return allFiles;

    if (seenCursors.has(nextCursor)) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API returned a repeated pagination cursor",
        status: 502,
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw API_CLIENT_ERROR.create({
    detail: `Veryfront API pagination exceeded ${MAX_LIST_ALL_PAGES} pages`,
    status: 502,
  });
}

export class VeryfrontAPIOperations {
  private tokenProvider: TokenProvider;
  private transport: VeryfrontApiTransport<unknown>;

  constructor(
    private apiBaseUrl: string,
    tokenOrProvider: string | TokenProvider,
    retryConfig: TransportRetryConfig,
    private projectId?: string,
  ) {
    this.tokenProvider = typeof tokenOrProvider === "string"
      ? () => tokenOrProvider
      : tokenOrProvider;
    this.transport = createCanonicalVeryfrontApiTransport(
      apiBaseUrl,
      () => this.tokenProvider(),
      retryConfig,
    );
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

  clearProjectId(): void {
    this.projectId = undefined;
  }

  getProjectId(): string {
    if (this.projectId) return this.projectId;

    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API client not initialized. Call initialize() with a project ID first.",
    });
  }

  async listProjects(options: ListProjectsOptions = {}): Promise<Project[]> {
    if (
      options.limit !== undefined &&
      (
        !Number.isSafeInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > DEFAULT_PAGE_LIMIT
      )
    ) {
      throw API_CLIENT_ERROR.create({
        detail: `Project-list limit must be an integer between 1 and ${DEFAULT_PAGE_LIMIT}`,
        status: 400,
      });
    }

    const params = new URLSearchParams();
    if (options.search) params.set("search", options.search);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.sortBy) params.set("sort_by", options.sortBy);
    if (options.sortOrder) params.set("sort_order", options.sortOrder);

    const query = params.toString();
    const raw = await this.request(query ? `/projects?${query}` : "/projects");
    return getListProjectsResponseSchema().parse(raw).data;
  }

  async getProject(projectRef: string, signal?: AbortSignal): Promise<Project> {
    const raw = await this.request(`/projects/${encodeURIComponent(projectRef)}`, { signal });
    return getProjectSchema().parse(raw);
  }

  async listBranchFiles(
    projectRef: string,
    branchRef = "main",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = addRuntimeServerFunctionAccess(buildListParams(options));
    params.set("branch", branchRef);
    const url = `/projects/${encodeURIComponent(projectRef)}/files?${params}`;
    logger.debug("listBranchFiles", { projectRef, branchRef, pattern: options.pattern });

    const raw = await this.request(url, { signal: options.signal });
    const response = getListBranchFilesResponseSchema().parse(raw);

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

  getBranchFile(
    projectRef: string,
    branchRef: string,
    pathOrId: string,
    options: GetFileOptions = {},
  ): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams({ branch: branchRef }));
        const url = `/projects/${encodeURIComponent(projectRef)}/files/${
          encodeURIComponent(pathOrId)
        }?${params}`;
        logger.debug("getBranchFile", { projectRef, branchRef, pathOrId });

        const raw = await this.request(url, { expected404: options.expectedMissing === true });
        const response = getBranchFileDetailSchema().parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          type: response.type,
          size: response.size,
          updated_at: response.updated_at,
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
    const params = addRuntimeServerFunctionAccess(buildListParams(options));
    const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
      encodeURIComponent(environmentName)
    }/files?${params}`;
    logger.debug("listEnvironmentFiles", {
      projectRef,
      environmentName,
      pattern: options.pattern,
    });

    const raw = await this.request(url, { signal: options.signal });
    const response = getListEnvironmentFilesResponseSchema().parse(raw);

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
    options: GetFileOptions = {},
  ): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams());
        const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
          encodeURIComponent(environmentName)
        }/files/${encodeURIComponent(pathOrId)}?${params}`;
        logger.debug("getEnvironmentFile", { projectRef, environmentName, pathOrId });

        const raw = await this.request(url, { expected404: options.expectedMissing === true });
        const response = getEnvironmentFileDetailSchema().parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          type: response.type,
          size: response.size,
          updated_at: response.updated_at,
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
    const params = addRuntimeServerFunctionAccess(buildListParams(options));
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/files?${params}`;
    logger.debug("listReleaseFiles", { projectRef, version, pattern: options.pattern });

    const raw = await this.request(url, { signal: options.signal });
    const response = getListReleaseFilesResponseSchema().parse(raw);

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

  getReleaseFile(
    projectRef: string,
    version: string,
    pathOrId: string,
    options: GetFileOptions = {},
  ): Promise<FileDetail> {
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams());
        const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
          encodeURIComponent(version)
        }/files/${encodeURIComponent(pathOrId)}?${params}`;
        logger.debug("getReleaseFile", { projectRef, version, pathOrId });

        const raw = await this.request(url, { expected404: options.expectedMissing === true });
        const response = getReleaseFileDetailSchema().parse(raw);

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          type: response.type,
          size: response.size,
          updated_at: response.updated_at,
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

  async lookupProjectByDomain(domain: string): Promise<LookupDomainResponse | null> {
    const normalizedDomain = normalizeLookupDomain(domain, "request");
    return await withSpan(
      SpanNames.API_DOMAIN_LOOKUP,
      async () => {
        const url = `/projects/${encodeURIComponent(normalizedDomain)}`;
        logger.debug("lookupProjectByDomain", { domain: normalizedDomain });

        try {
          const raw = await this.request(url);
          const project = getProjectWithEnvironmentsSchema().parse(raw);

          const matchingEnv = project.environments?.find((env) =>
            env.domains?.some((candidate) =>
              normalizeLookupDomain(candidate, "upstream") === normalizedDomain
            )
          );

          const response: LookupDomainResponse = {
            project_id: project.id,
            project_slug: project.slug,
            project_name: project.name,
            environment: matchingEnv ? { id: matchingEnv.id, name: matchingEnv.name } : null,
            release_id: matchingEnv?.active_release_id ?? null,
          };

          logger.debug("Domain lookup result", {
            domain: normalizedDomain,
            projectSlug: response.project_slug,
            environment: response.environment?.name,
          });

          return response;
        } catch (error) {
          if (error instanceof VeryfrontError && error.status === 404) {
            logger.debug("No project found for domain", { domain: normalizedDomain });
            return null;
          }
          throw error;
        }
      },
      { "api.domain": normalizedDomain },
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

  async ensureStyleArtifactBuild(
    projectRef: string,
    input: EnsureStyleArtifactBuildInput,
  ): Promise<ProjectStyleArtifactResolution> {
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current/builds`;
    logger.debug("ensureStyleArtifactBuild", {
      projectRef,
      branch: input.branch,
      environmentName: input.environmentName,
      releaseId: input.releaseId,
      styleProfileHash: input.styleProfileHash,
      force: input.force ?? false,
    });

    return mapStyleArtifactResolution(
      await this.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style_profile_hash: input.styleProfileHash,
          branch: input.branch,
          environment_name: input.environmentName,
          release_id: input.releaseId,
          force: input.force ?? false,
        }),
      }),
    );
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
      status: input.status ?? "ready",
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
          status: input.status ?? "ready",
          artifact_hash: input.artifactHash,
          asset_path: input.assetPath,
          content_type: input.contentType,
          etag: input.etag,
          build_run_id: input.buildRunId,
          failure_reason: input.failureReason,
        }),
      }),
    );
  }

  // ===========================================================================
  // Release Asset Manifest operations
  // ===========================================================================

  async beginReleaseAssetManifestBuild(
    projectRef: string,
    version: string,
  ): Promise<ReleaseAssetManifestBuildResponse> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/asset-manifest/builds`;
    logger.debug("beginReleaseAssetManifestBuild", { projectRef, version });

    const raw = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return getReleaseAssetManifestBuildResponseSchema().parse(raw);
  }

  async uploadReleaseAsset(
    projectRef: string,
    version: string,
    contentHash: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<ReleaseAssetUploadResponse> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/asset-manifest/assets`;
    logger.debug("uploadReleaseAsset", {
      projectRef,
      version,
      contentHash,
      contentType,
      size: bytes.byteLength,
    });

    const raw = await this.request(url, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "x-vf-content-hash": contentHash,
      },
      body: bytes as BodyInit,
    });
    return getReleaseAssetUploadResponseSchema().parse(raw);
  }

  async putReleaseAssetManifest(
    projectRef: string,
    version: string,
    manifest: unknown,
  ): Promise<ReleaseAssetManifestStateResponse> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/asset-manifest`;
    logger.debug("putReleaseAssetManifest", { projectRef, version });

    const raw = await this.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    return getReleaseAssetManifestStateResponseSchema().parse(raw);
  }

  async reportReleaseAssetManifestState(
    projectRef: string,
    version: string,
    state: "partial" | "failed",
    error?: string,
  ): Promise<ReleaseAssetManifestStateResponse> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/asset-manifest/state`;
    logger.debug("reportReleaseAssetManifestState", { projectRef, version, state });

    const raw = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(error ? { state, error } : { state }),
    });
    return getReleaseAssetManifestStateResponseSchema().parse(raw);
  }

  async getReleaseAssetManifest(
    projectRef: string,
    version: string,
  ): Promise<ReleaseAssetManifestApiResponse> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/asset-manifest`;
    logger.debug("getReleaseAssetManifest", { projectRef, version });

    const raw = await this.request(url);
    return getReleaseAssetManifestResponseSchema().parse(raw);
  }

  private request(endpoint: string, options: TransportRequestInit = {}): Promise<unknown> {
    return withSpan(
      SpanNames.API_REQUEST,
      () => this.transport.request(endpoint, options),
      { "api.endpoint": endpoint, "api.base_url": this.apiBaseUrl },
    );
  }
}
