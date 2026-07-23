import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  DEFAULT_VERYFRONT_API_REQUEST_POLICY,
  type RequestOptions,
  type RequestTelemetry,
  requestWithRetry,
  type ResolvedVeryfrontAPIRequestPolicy,
  type RetryConfig,
  snapshotAPIRequestPolicy,
  validateRetryConfig,
} from "./retry-handler.ts";
import {
  API_CLIENT_ERROR,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  type VeryfrontAPIRequestPolicy,
  VeryfrontError,
} from "./types.ts";
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
const DEFAULT_MAX_PAGINATION_PAGES = 1_000;
const DEFAULT_MAX_PAGINATION_FILES = 100_000;
const MEDIA_TYPE_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+(?:\s*;\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=(?:"[^"\r\n]*"|[!#$%&'*+\-.^_`|~0-9A-Za-z]+))*$/;
const RELEASE_ASSET_FAILURE_DETAIL = "Release asset manifest build failed";
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const API_ROUTES = Object.freeze(
  {
    listProjects: "/projects",
    getProject: "/projects/{project}",
    listBranchFiles: "/projects/{project}/files",
    getBranchFile: "/projects/{project}/files/{file}",
    listEnvironmentFiles: "/projects/{project}/environments/{environment}/files",
    getEnvironmentFile: "/projects/{project}/environments/{environment}/files/{file}",
    listReleaseFiles: "/projects/{project}/releases/{release}/files",
    getReleaseFile: "/projects/{project}/releases/{release}/files/{file}",
    lookupProjectByDomain: "/projects/{domain}",
    resolveStyleArtifact: "/projects/{project}/style-artifacts/current",
    ensureStyleArtifactBuild: "/projects/{project}/style-artifacts/current/builds",
    upsertStyleArtifact: "/projects/{project}/style-artifacts/current",
    beginReleaseAssetManifestBuild: "/projects/{project}/releases/{release}/asset-manifest/builds",
    uploadReleaseAsset: "/projects/{project}/releases/{release}/asset-manifest/assets",
    putReleaseAssetManifest: "/projects/{project}/releases/{release}/asset-manifest",
    reportReleaseAssetManifestState: "/projects/{project}/releases/{release}/asset-manifest/state",
    getReleaseAssetManifest: "/projects/{project}/releases/{release}/asset-manifest",
  } as const,
);

type ApiOperation = keyof typeof API_ROUTES;

interface SafeOperationLogContext {
  fileCount?: number;
  force?: boolean;
  found?: boolean;
  hasArtifact?: boolean;
  hasBranchSelector?: boolean;
  hasEnvironment?: boolean;
  hasEnvironmentSelector?: boolean;
  hasPattern?: boolean;
  hasReleaseSelector?: boolean;
  sizeBytes?: number;
  state?: "partial" | "failed";
  status?: "building" | "ready" | "failed";
}

function telemetryFor(operation: ApiOperation): RequestTelemetry {
  return { operation, route: API_ROUTES[operation] };
}

function telemetryAttributes(operation: ApiOperation): Record<string, string> {
  return {
    "api.operation": operation,
    "api.route": API_ROUTES[operation],
  };
}

function logOperation(
  operation: ApiOperation,
  context: SafeOperationLogContext = {},
): void {
  logger.debug("Veryfront API operation", {
    operation,
    route: API_ROUTES[operation],
    ...context,
  });
}

export type TokenProvider = () => string;

export interface ListFilesOptions {
  cursor?: string;
  limit?: number;
  path?: string;
  pattern?: string;
  sortBy?: "path" | "updated_at";
  sortOrder?: "asc" | "desc";
}

export interface ListAllFilesOptions extends Omit<ListFilesOptions, "cursor"> {
  /** Maximum pages to request before rejecting a non-terminating result. */
  maxPages?: number;
  /** Maximum files to retain in the returned array. */
  maxFiles?: number;
}

interface ListFilesSnapshot {
  readonly cursor?: string;
  readonly limit?: number;
  readonly path?: string;
  readonly pattern?: string;
  readonly sortBy?: "path" | "updated_at";
  readonly sortOrder?: "asc" | "desc";
}

interface ListAllFilesSnapshot extends Omit<ListFilesSnapshot, "cursor"> {
  readonly maxPages: number;
  readonly maxFiles: number;
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

function invalidInput(detail: string): VeryfrontError {
  return API_CLIENT_ERROR.create({ detail, status: 400 });
}

function isApiClientError(error: unknown): error is VeryfrontError {
  try {
    return error instanceof VeryfrontError && error.slug === "api-client-error";
  } catch (_) {
    return false;
  }
}

function snapshotProperties(
  value: unknown,
  label: string,
  properties: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw invalidInput(`${label} must be an object`);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch (_) {
    throw invalidInput(`${label} could not be read`);
  }
  if (isArray) throw invalidInput(`${label} must be an object`);
  const snapshot: Record<string, unknown> = {};
  try {
    for (const property of properties) snapshot[property] = Reflect.get(value, property);
  } catch (_) {
    throw invalidInput(`${label} could not be read`);
  }
  return snapshot;
}

function snapshotString(value: unknown, label: string): string {
  if (typeof value !== "string") throw invalidInput(`${label} must be a string`);
  return value;
}

function snapshotOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return snapshotString(value, label);
}

function snapshotOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalidInput(`${label} must be a boolean`);
  return value;
}

function validateListLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw API_CLIENT_ERROR.create({
      detail: "List limit must be a positive integer",
      status: 400,
    });
  }
}

function snapshotListFilesOptions(options: unknown): Readonly<ListFilesSnapshot> {
  const values = snapshotProperties(options, "File list options", [
    "cursor",
    "limit",
    "path",
    "pattern",
    "sortBy",
    "sortOrder",
  ]);
  const limit = values.limit as number | undefined;
  validateListLimit(limit);
  const sortBy = values.sortBy;
  if (sortBy !== undefined && sortBy !== "path" && sortBy !== "updated_at") {
    throw invalidInput("File list sortBy must be path or updated_at");
  }
  const sortOrder = values.sortOrder;
  if (sortOrder !== undefined && sortOrder !== "asc" && sortOrder !== "desc") {
    throw invalidInput("File list sortOrder must be asc or desc");
  }
  return Object.freeze({
    cursor: snapshotOptionalString(values.cursor, "File list cursor"),
    limit,
    path: snapshotOptionalString(values.path, "File list path"),
    pattern: snapshotOptionalString(values.pattern, "File list pattern"),
    sortBy: sortBy as ListFilesSnapshot["sortBy"],
    sortOrder: sortOrder as ListFilesSnapshot["sortOrder"],
  });
}

function snapshotListAllFilesOptions(options: unknown): Readonly<ListAllFilesSnapshot> {
  const values = snapshotProperties(options, "File pagination options", [
    "limit",
    "path",
    "pattern",
    "sortBy",
    "sortOrder",
    "maxPages",
    "maxFiles",
  ]);
  const list = snapshotListFilesOptions(values);
  const maxPages = values.maxPages === undefined ? DEFAULT_MAX_PAGINATION_PAGES : values.maxPages;
  const maxFiles = values.maxFiles === undefined ? DEFAULT_MAX_PAGINATION_FILES : values.maxFiles;
  if (!Number.isSafeInteger(maxPages) || (maxPages as number) <= 0) {
    throw invalidInput("Pagination maxPages must be a positive integer");
  }
  if (!Number.isSafeInteger(maxFiles) || (maxFiles as number) <= 0) {
    throw invalidInput("Pagination maxFiles must be a positive integer");
  }
  return Object.freeze({
    limit: list.limit,
    path: list.path,
    pattern: list.pattern,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    maxPages: maxPages as number,
    maxFiles: maxFiles as number,
  });
}

function buildListParams(options: Readonly<ListFilesSnapshot>): URLSearchParams {
  const {
    cursor,
    limit = DEFAULT_PAGE_LIMIT,
    path,
    pattern,
    sortBy = "updated_at",
    sortOrder = "desc",
  } = options;
  validateListLimit(limit);

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

interface StyleArtifactInputSnapshot extends UpsertStyleArtifactInput {
  readonly force?: boolean;
}

function snapshotStyleArtifactInput(
  input: unknown,
  kind: "resolve" | "ensure" | "upsert",
): Readonly<StyleArtifactInputSnapshot> {
  const properties = [
    "styleProfileHash",
    "branch",
    "environmentName",
    "releaseId",
  ];
  if (kind === "ensure") properties.push("force");
  if (kind === "upsert") {
    properties.push(
      "status",
      "artifactHash",
      "assetPath",
      "contentType",
      "etag",
      "buildRunId",
      "failureReason",
    );
  }
  const values = snapshotProperties(input, "Style artifact input", properties);
  const status = values.status;
  if (
    status !== undefined && status !== "building" && status !== "ready" && status !== "failed"
  ) {
    throw invalidInput("Style artifact status is invalid");
  }
  return Object.freeze({
    styleProfileHash: snapshotString(values.styleProfileHash, "Style profile hash"),
    branch: snapshotOptionalString(values.branch, "Style artifact branch"),
    environmentName: snapshotOptionalString(
      values.environmentName,
      "Style artifact environment name",
    ),
    releaseId: snapshotOptionalString(values.releaseId, "Style artifact release ID"),
    force: snapshotOptionalBoolean(values.force, "Style artifact force"),
    status: status as UpsertStyleArtifactInput["status"],
    artifactHash: snapshotOptionalString(values.artifactHash, "Style artifact hash"),
    assetPath: snapshotOptionalString(values.assetPath, "Style artifact asset path"),
    contentType: snapshotOptionalString(values.contentType, "Style artifact content type"),
    etag: snapshotOptionalString(values.etag, "Style artifact etag"),
    buildRunId: snapshotOptionalString(values.buildRunId, "Style artifact build run ID"),
    failureReason: snapshotOptionalString(
      values.failureReason,
      "Style artifact failure reason",
    ),
  });
}

function buildStyleArtifactParams(input: Readonly<ResolveStyleArtifactInput>): URLSearchParams {
  const params = new URLSearchParams({
    style_profile_hash: input.styleProfileHash,
  });

  if (input.branch) params.set("branch", input.branch);
  if (input.environmentName) params.set("environment_name", input.environmentName);
  if (input.releaseId) params.set("release_id", input.releaseId);

  return params;
}

interface ApiResponseSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; issues: readonly unknown[] };
}

function parseApiResponse<T>(
  schema: ApiResponseSchema<T>,
  raw: unknown,
  operation: string,
): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  throw API_CLIENT_ERROR.create({
    detail: "Veryfront API returned an invalid response",
    status: 502,
    context: {
      details: {
        operation,
        issueCount: result.issues.length,
      },
    },
  });
}

function serializeJsonBody(value: unknown, operation: string): string {
  try {
    const body = JSON.stringify(value);
    if (body === undefined) throw new TypeError("JSON serialization returned undefined");
    return body;
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API request body must be JSON-serializable",
      status: 400,
      context: { details: { operation } },
    });
  }
}

async function validateAssetUpload(
  contentHash: unknown,
  contentType: unknown,
  bytes: unknown,
): Promise<Readonly<{ contentHash: string; contentType: string; bytes: Uint8Array }>> {
  if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/i.test(contentHash)) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset content hash must be a SHA-256 hexadecimal value",
      status: 400,
    });
  }
  if (typeof contentType !== "string" || !MEDIA_TYPE_PATTERN.test(contentType.trim())) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset content type must be a valid media type",
      status: 400,
    });
  }
  try {
    new Headers({ "Content-Type": contentType });
  } catch (_) {
    throw API_CLIENT_ERROR.create({ detail: "Release asset content type is invalid", status: 400 });
  }
  let isByteArray = false;
  try {
    isByteArray = bytes instanceof Uint8Array;
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset body is invalid",
      status: 400,
    });
  }
  if (!isByteArray) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset body must be a byte array",
      status: 400,
    });
  }

  let byteLength: number;
  try {
    byteLength = typedArrayByteLengthGetter?.call(bytes) as number;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new TypeError("invalid length");
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset body could not be read",
      status: 400,
    });
  }
  if (byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset body exceeds the 10 MiB upload limit",
      status: 413,
    });
  }

  let bytesSnapshot: Uint8Array;
  try {
    bytesSnapshot = Uint8Array.prototype.slice.call(bytes);
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset body could not be read",
      status: 400,
    });
  }
  let actualHash: string;
  try {
    const digestInput = new Uint8Array(bytesSnapshot.byteLength);
    digestInput.set(bytesSnapshot);
    const digest = await crypto.subtle.digest("SHA-256", digestInput);
    actualHash = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset integrity could not be verified",
      status: 500,
    });
  }
  if (actualHash !== contentHash.toLowerCase()) {
    throw API_CLIENT_ERROR.create({
      detail: "Release asset content hash does not match the uploaded bytes",
      status: 400,
    });
  }
  return Object.freeze({
    contentHash: contentHash.toLowerCase(),
    contentType: contentType.trim(),
    bytes: bytesSnapshot,
  });
}

function buildApiUrl(apiBaseUrl: string, endpoint: string): string {
  let baseUrl: URL;
  try {
    baseUrl = new URL(apiBaseUrl);
  } catch (_) {
    throw API_CLIENT_ERROR.create({ detail: "Veryfront API base URL is invalid", status: 400 });
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API base URL must use HTTP or HTTPS",
      status: 400,
    });
  }
  if (baseUrl.username || baseUrl.password) {
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API base URL must not contain credentials",
      status: 400,
    });
  }
  if (baseUrl.search || baseUrl.hash) {
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API base URL must not contain a query or fragment",
      status: 400,
    });
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  const endpointPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseUrl.origin}${basePath}${endpointPath}`;
}

function normalizeLookupDomain(domain: string): string {
  const candidate = domain.trim();
  try {
    const parsed = new URL(`http://${candidate}`);
    if (
      !candidate || parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || !parsed.hostname
    ) {
      throw new Error("invalid domain");
    }
    return parsed.hostname.toLowerCase();
  } catch (_) {
    throw API_CLIENT_ERROR.create({
      detail: "Domain lookup requires a hostname with an optional port",
      status: 400,
    });
  }
}

function mapStyleArtifactResolution(raw: unknown): ProjectStyleArtifactResolution {
  const response = parseApiResponse(
    getStyleArtifactResolveResponseSchema(),
    raw,
    "resolveStyleArtifact",
  );
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

function remainingRequestPolicy(
  requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>,
  deadline: number,
  operation: string,
): Readonly<ResolvedVeryfrontAPIRequestPolicy> {
  const remainingTimeoutMs = Math.ceil(deadline - performance.now());
  if (remainingTimeoutMs <= 0) {
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API operation exceeded its total timeout",
      status: 504,
      context: { details: { operation } },
    });
  }
  return Object.freeze({
    ...requestPolicy,
    totalTimeoutMs: remainingTimeoutMs,
  });
}

async function listAllFiles(
  list: (
    cursor: string | undefined,
    limit: number,
    requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>,
  ) => Promise<FileListResult>,
  options: Readonly<ListAllFilesSnapshot>,
  requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>,
): Promise<ProjectFile[]> {
  const allFiles: ProjectFile[] = [];
  const seenCursors = new Set<string>();
  const { maxPages, maxFiles } = options;
  const deadline = performance.now() + requestPolicy.totalTimeoutMs;
  let cursor: string | undefined;
  let pageCount = 0;

  while (true) {
    const remainingFiles = maxFiles - allFiles.length;
    if (remainingFiles <= 0) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API pagination exceeded the configured file budget",
        status: 502,
        context: { details: { operation: "listAllFiles", maxFiles } },
      });
    }
    const pageLimit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, remainingFiles);
    const pagePolicy = remainingRequestPolicy(requestPolicy, deadline, "listAllFiles");
    const result = await list(cursor, pageLimit, pagePolicy);
    pageCount++;
    if (result.files.length > maxFiles - allFiles.length) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API pagination exceeded the configured file budget",
        status: 502,
        context: { details: { operation: "listAllFiles", maxFiles } },
      });
    }
    allFiles.push(...result.files);
    const nextCursor = result.page_info.next ?? undefined;
    if (!nextCursor) return allFiles;
    if (pageCount >= maxPages) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API pagination exceeded the configured page budget",
        status: 502,
        context: { details: { operation: "listAllFiles", maxPages } },
      });
    }
    if (seenCursors.has(nextCursor)) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API returned a repeated pagination cursor",
        status: 502,
        context: { details: { operation: "listAllFiles" } },
      });
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export class VeryfrontAPIOperations {
  private tokenProvider: TokenProvider;
  private readonly apiBaseUrl: string;
  private readonly retryConfig: RetryConfig;
  private readonly requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>;
  private projectId?: string;

  constructor(
    apiBaseUrl: string,
    tokenOrProvider: string | TokenProvider,
    retryConfig: RetryConfig,
    projectId?: string,
    requestPolicy: VeryfrontAPIRequestPolicy = DEFAULT_VERYFRONT_API_REQUEST_POLICY,
  ) {
    this.apiBaseUrl = snapshotString(apiBaseUrl, "Veryfront API base URL");
    const retry = snapshotProperties(retryConfig, "Retry configuration", [
      "maxRetries",
      "initialDelay",
      "maxDelay",
    ]);
    const retrySnapshot = Object.freeze({
      maxRetries: retry.maxRetries as number,
      initialDelay: retry.initialDelay as number,
      maxDelay: retry.maxDelay as number,
    });
    validateRetryConfig(retrySnapshot);
    this.retryConfig = retrySnapshot;
    this.projectId = projectId === undefined
      ? undefined
      : snapshotString(projectId, "Veryfront API project ID");
    this.requestPolicy = snapshotAPIRequestPolicy(requestPolicy);
    if (typeof tokenOrProvider !== "string" && typeof tokenOrProvider !== "function") {
      throw invalidInput("Veryfront API token or token provider is invalid");
    }
    this.tokenProvider = typeof tokenOrProvider === "string"
      ? () => tokenOrProvider
      : tokenOrProvider;
  }

  setTokenProvider(provider: TokenProvider): void {
    if (typeof provider !== "function") throw invalidInput("Token provider must be a function");
    this.tokenProvider = provider;
  }

  getToken(): string {
    let token: unknown;
    try {
      token = this.tokenProvider();
    } catch (error) {
      if (isApiClientError(error)) throw error;
      throw API_CLIENT_ERROR.create({
        detail: "Unable to resolve the Veryfront API token",
        status: 401,
      });
    }
    if (typeof token !== "string" || token.trim().length === 0) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API token must be a non-empty string",
        status: 401,
      });
    }
    try {
      new Headers({ Authorization: `Bearer ${token}` });
    } catch (_) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API token is invalid",
        status: 401,
      });
    }
    return token;
  }

  setProjectId(projectId: string): void {
    this.projectId = snapshotString(projectId, "Veryfront API project ID");
  }

  getProjectId(): string {
    if (this.projectId) return this.projectId;

    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API client not initialized. Call initialize() with a project ID first.",
    });
  }

  private withCapturedToken(
    requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>,
  ): VeryfrontAPIOperations {
    return new VeryfrontAPIOperations(
      this.apiBaseUrl,
      this.getToken(),
      this.retryConfig,
      this.projectId,
      requestPolicy,
    );
  }

  async listProjects(options?: {
    search?: string;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }, requestPolicy?: VeryfrontAPIRequestPolicy): Promise<Project[]> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const values = snapshotProperties(options ?? {}, "Project list options", [
      "search",
      "limit",
      "sortBy",
      "sortOrder",
    ]);
    const search = snapshotOptionalString(values.search, "Project search");
    const limit = values.limit as number | undefined;
    validateListLimit(limit);
    const sortBy = snapshotOptionalString(values.sortBy, "Project sort field");
    const sortOrder = values.sortOrder;
    if (sortOrder !== undefined && sortOrder !== "asc" && sortOrder !== "desc") {
      throw invalidInput("Project sort order must be asc or desc");
    }
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (limit) params.set("limit", String(limit));
    if (sortBy) params.set("sort_by", sortBy);
    if (sortOrder) params.set("sort_order", sortOrder);

    const query = params.toString();
    const raw = await this.request(
      "listProjects",
      query ? `/projects?${query}` : "/projects",
      {},
      undefined,
      policy,
    );
    return parseApiResponse(getListProjectsResponseSchema(), raw, "listProjects").data;
  }

  async getProject(
    projectRef: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<Project> {
    return await this.getProjectForInitialization(projectRef, undefined, requestPolicy);
  }

  /** Fetch a project with a token captured by the caller's request context. */
  async getProjectForInitialization(
    projectRef: string,
    apiToken?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<Project> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const token = apiToken === undefined ? undefined : snapshotString(apiToken, "API token");
    const raw = await this.request(
      "getProject",
      `/projects/${encodeURIComponent(project)}`,
      {},
      token,
      policy,
    );
    return parseApiResponse(getProjectSchema(), raw, "getProject");
  }

  async listBranchFiles(
    projectRef: string,
    branchRef = "main",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileListResult> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const branch = snapshotString(branchRef, "Branch reference");
    const listOptions = snapshotListFilesOptions(options);
    const params = addRuntimeServerFunctionAccess(buildListParams(listOptions));
    params.set("branch", branch);
    const url = `/projects/${encodeURIComponent(project)}/files?${params}`;
    logOperation("listBranchFiles", { hasPattern: listOptions.pattern !== undefined });

    const raw = await this.request("listBranchFiles", url, {}, undefined, policy);
    const response = parseApiResponse(getListBranchFilesResponseSchema(), raw, "listBranchFiles");

    return {
      files: response.data.map(mapProjectFile),
      page_info: response.page_info,
    };
  }

  async listAllBranchFiles(
    projectRef: string,
    branchRef = "main",
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectFile[]> {
    const project = snapshotString(projectRef, "Project reference");
    const branch = snapshotString(branchRef, "Branch reference");
    const listOptions = snapshotListAllFilesOptions(options);
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const pageOperations = this.withCapturedToken(policy);
    const allFiles = await listAllFiles(
      (cursor, limit, pagePolicy) =>
        pageOperations.listBranchFiles(project, branch, {
          ...listOptions,
          cursor,
          limit,
        }, pagePolicy),
      listOptions,
      policy,
    );

    logOperation("listBranchFiles", { fileCount: allFiles.length });

    return allFiles;
  }

  getBranchFile(
    projectRef: string,
    branchRef: string,
    pathOrId: string,
    options: GetFileOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileDetail> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const branch = snapshotString(branchRef, "Branch reference");
    const file = snapshotString(pathOrId, "File path or ID");
    const fileOptions = snapshotProperties(options, "Get file options", ["expectedMissing"]);
    const expectedMissing = snapshotOptionalBoolean(
      fileOptions.expectedMissing,
      "Get file expectedMissing",
    ) ?? false;
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams({ branch }));
        const url = `/projects/${encodeURIComponent(project)}/files/${
          encodeURIComponent(file)
        }?${params}`;
        logOperation("getBranchFile");

        const raw = await this.request(
          "getBranchFile",
          url,
          {
            expected404: expectedMissing,
          },
          undefined,
          policy,
        );
        const response = parseApiResponse(getBranchFileDetailSchema(), raw, "getBranchFile");

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          type: response.type,
          size: response.size,
        };
      },
      telemetryAttributes("getBranchFile"),
    );
  }

  async listEnvironmentFiles(
    projectRef: string,
    environmentName = "production",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileListResult> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const environment = snapshotString(environmentName, "Environment name");
    const listOptions = snapshotListFilesOptions(options);
    const params = addRuntimeServerFunctionAccess(buildListParams(listOptions));
    const url = `/projects/${encodeURIComponent(project)}/environments/${
      encodeURIComponent(environment)
    }/files?${params}`;
    logOperation("listEnvironmentFiles", { hasPattern: listOptions.pattern !== undefined });

    const raw = await this.request("listEnvironmentFiles", url, {}, undefined, policy);
    const response = parseApiResponse(
      getListEnvironmentFilesResponseSchema(),
      raw,
      "listEnvironmentFiles",
    );

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
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectFile[]> {
    const project = snapshotString(projectRef, "Project reference");
    const environment = snapshotString(environmentName, "Environment name");
    const listOptions = snapshotListAllFilesOptions(options);
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const pageOperations = this.withCapturedToken(policy);
    const allFiles = await listAllFiles(
      (cursor, limit, pagePolicy) =>
        pageOperations.listEnvironmentFiles(project, environment, {
          ...listOptions,
          cursor,
          limit,
        }, pagePolicy),
      listOptions,
      policy,
    );

    logOperation("listEnvironmentFiles", { fileCount: allFiles.length });

    return allFiles;
  }

  getEnvironmentFile(
    projectRef: string,
    environmentName: string,
    pathOrId: string,
    options: GetFileOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileDetail> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const environment = snapshotString(environmentName, "Environment name");
    const file = snapshotString(pathOrId, "File path or ID");
    const fileOptions = snapshotProperties(options, "Get file options", ["expectedMissing"]);
    const expectedMissing = snapshotOptionalBoolean(
      fileOptions.expectedMissing,
      "Get file expectedMissing",
    ) ?? false;
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams());
        const url = `/projects/${encodeURIComponent(project)}/environments/${
          encodeURIComponent(environment)
        }/files/${encodeURIComponent(file)}?${params}`;
        logOperation("getEnvironmentFile");

        const raw = await this.request(
          "getEnvironmentFile",
          url,
          {
            expected404: expectedMissing,
          },
          undefined,
          policy,
        );
        const response = parseApiResponse(
          getEnvironmentFileDetailSchema(),
          raw,
          "getEnvironmentFile",
        );

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          release_id: response.release_id,
          release_version: response.release_version,
        };
      },
      telemetryAttributes("getEnvironmentFile"),
    );
  }

  async listReleaseFiles(
    projectRef: string,
    version = "latest",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileListResult> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const listOptions = snapshotListFilesOptions(options);
    const params = addRuntimeServerFunctionAccess(buildListParams(listOptions));
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/files?${params}`;
    logOperation("listReleaseFiles", { hasPattern: listOptions.pattern !== undefined });

    const raw = await this.request("listReleaseFiles", url, {}, undefined, policy);
    const response = parseApiResponse(getListReleaseFilesResponseSchema(), raw, "listReleaseFiles");

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
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectFile[]> {
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const listOptions = snapshotListAllFilesOptions(options);
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const pageOperations = this.withCapturedToken(policy);
    return listAllFiles(
      (cursor, limit, pagePolicy) =>
        pageOperations.listReleaseFiles(project, release, {
          ...listOptions,
          cursor,
          limit,
        }, pagePolicy),
      listOptions,
      policy,
    );
  }

  getReleaseFile(
    projectRef: string,
    version: string,
    pathOrId: string,
    options: GetFileOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileDetail> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const file = snapshotString(pathOrId, "File path or ID");
    const fileOptions = snapshotProperties(options, "Get file options", ["expectedMissing"]);
    const expectedMissing = snapshotOptionalBoolean(
      fileOptions.expectedMissing,
      "Get file expectedMissing",
    ) ?? false;
    return withSpan(
      SpanNames.API_GET_FILE,
      async () => {
        const params = addRuntimeServerFunctionAccess(new URLSearchParams());
        const url = `/projects/${encodeURIComponent(project)}/releases/${
          encodeURIComponent(release)
        }/files/${encodeURIComponent(file)}?${params}`;
        logOperation("getReleaseFile");

        const raw = await this.request(
          "getReleaseFile",
          url,
          {
            expected404: expectedMissing,
          },
          undefined,
          policy,
        );
        const response = parseApiResponse(getReleaseFileDetailSchema(), raw, "getReleaseFile");

        return {
          path: response.path,
          content: response.content,
          id: response.id,
          version_id: response.version_id,
          release_id: response.release_id,
          release_version: response.release_version,
        };
      },
      telemetryAttributes("getReleaseFile"),
    );
  }

  lookupProjectByDomain(
    domain: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<LookupDomainResponse | null> {
    const normalizedDomain = normalizeLookupDomain(snapshotString(domain, "Domain"));
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    return withSpan(
      SpanNames.API_DOMAIN_LOOKUP,
      async () => {
        const url = `/projects/${encodeURIComponent(normalizedDomain)}`;
        logOperation("lookupProjectByDomain");

        try {
          const raw = await this.request("lookupProjectByDomain", url, {}, undefined, policy);
          const project = parseApiResponse(
            getProjectWithEnvironmentsSchema(),
            raw,
            "lookupProjectByDomain",
          );

          const matchingEnv = project.environments?.find((env) =>
            env.domains?.some((d) => d.toLowerCase() === normalizedDomain)
          );

          const response: LookupDomainResponse = {
            project_id: project.id,
            project_slug: project.slug,
            project_name: project.name,
            environment: matchingEnv ? { id: matchingEnv.id, name: matchingEnv.name } : null,
            release_id: matchingEnv?.active_release_id ?? null,
          };

          logOperation("lookupProjectByDomain", {
            found: true,
            hasEnvironment: response.environment !== null,
          });

          return response;
        } catch (error) {
          if (error instanceof VeryfrontError && error.status === 404) {
            logOperation("lookupProjectByDomain", { found: false });
            return null;
          }
          throw error;
        }
      },
      telemetryAttributes("lookupProjectByDomain"),
    );
  }

  async resolveStyleArtifact(
    projectRef: string,
    input: ResolveStyleArtifactInput,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const styleInput = snapshotStyleArtifactInput(input, "resolve");
    const params = buildStyleArtifactParams(styleInput);
    const url = `/projects/${encodeURIComponent(project)}/style-artifacts/current?${params}`;
    logOperation("resolveStyleArtifact", {
      hasBranchSelector: styleInput.branch !== undefined,
      hasEnvironmentSelector: styleInput.environmentName !== undefined,
      hasReleaseSelector: styleInput.releaseId !== undefined,
    });

    return mapStyleArtifactResolution(
      await this.request("resolveStyleArtifact", url, {}, undefined, policy),
    );
  }

  async ensureStyleArtifactBuild(
    projectRef: string,
    input: EnsureStyleArtifactBuildInput,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const styleInput = snapshotStyleArtifactInput(input, "ensure");
    const url = `/projects/${encodeURIComponent(project)}/style-artifacts/current/builds`;
    logOperation("ensureStyleArtifactBuild", {
      hasBranchSelector: styleInput.branch !== undefined,
      hasEnvironmentSelector: styleInput.environmentName !== undefined,
      hasReleaseSelector: styleInput.releaseId !== undefined,
      force: styleInput.force ?? false,
    });

    return mapStyleArtifactResolution(
      await this.request(
        "ensureStyleArtifactBuild",
        url,
        {
          method: "POST",
          retryable: true,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            style_profile_hash: styleInput.styleProfileHash,
            branch: styleInput.branch,
            environment_name: styleInput.environmentName,
            release_id: styleInput.releaseId,
            force: styleInput.force ?? false,
          }),
        },
        undefined,
        policy,
      ),
    );
  }

  async upsertStyleArtifact(
    projectRef: string,
    input: UpsertStyleArtifactInput,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const styleInput = snapshotStyleArtifactInput(input, "upsert");
    const url = `/projects/${encodeURIComponent(project)}/style-artifacts/current`;
    logOperation("upsertStyleArtifact", {
      hasBranchSelector: styleInput.branch !== undefined,
      hasEnvironmentSelector: styleInput.environmentName !== undefined,
      hasReleaseSelector: styleInput.releaseId !== undefined,
      status: styleInput.status ?? "ready",
      hasArtifact: styleInput.artifactHash !== undefined,
    });

    return mapStyleArtifactResolution(
      await this.request(
        "upsertStyleArtifact",
        url,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            style_profile_hash: styleInput.styleProfileHash,
            branch: styleInput.branch,
            environment_name: styleInput.environmentName,
            release_id: styleInput.releaseId,
            status: styleInput.status ?? "ready",
            artifact_hash: styleInput.artifactHash,
            asset_path: styleInput.assetPath,
            content_type: styleInput.contentType,
            etag: styleInput.etag,
            build_run_id: styleInput.buildRunId,
            failure_reason: styleInput.failureReason,
          }),
        },
        undefined,
        policy,
      ),
    );
  }

  // ===========================================================================
  // Release Asset Manifest operations
  // ===========================================================================

  async beginReleaseAssetManifestBuild(
    projectRef: string,
    version: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ReleaseAssetManifestBuildResponse> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/asset-manifest/builds`;
    logOperation("beginReleaseAssetManifestBuild");

    const raw = await this.request(
      "beginReleaseAssetManifestBuild",
      url,
      {
        method: "POST",
        retryable: true,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      undefined,
      policy,
    );
    return parseApiResponse(
      getReleaseAssetManifestBuildResponseSchema(),
      raw,
      "beginReleaseAssetManifestBuild",
    );
  }

  async uploadReleaseAsset(
    projectRef: string,
    version: string,
    contentHash: string,
    contentType: string,
    bytes: Uint8Array,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ReleaseAssetUploadResponse> {
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const deadline = performance.now() + policy.totalTimeoutMs;
    const apiToken = this.getToken();
    const upload = await validateAssetUpload(contentHash, contentType, bytes);
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/asset-manifest/assets`;
    logOperation("uploadReleaseAsset", { sizeBytes: upload.bytes.byteLength });

    const raw = await this.request(
      "uploadReleaseAsset",
      url,
      {
        method: "POST",
        retryable: true,
        headers: {
          "Content-Type": upload.contentType,
          "x-vf-content-hash": upload.contentHash,
        },
        body: upload.bytes as BodyInit,
      },
      apiToken,
      remainingRequestPolicy(policy, deadline, "uploadReleaseAsset"),
    );
    return parseApiResponse(getReleaseAssetUploadResponseSchema(), raw, "uploadReleaseAsset");
  }

  async putReleaseAssetManifest(
    projectRef: string,
    version: string,
    manifest: unknown,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ReleaseAssetManifestStateResponse> {
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const body = serializeJsonBody(manifest, "putReleaseAssetManifest");
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/asset-manifest`;
    logOperation("putReleaseAssetManifest");

    const raw = await this.request(
      "putReleaseAssetManifest",
      url,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      },
      undefined,
      policy,
    );
    return parseApiResponse(
      getReleaseAssetManifestStateResponseSchema(),
      raw,
      "putReleaseAssetManifest",
    );
  }

  async reportReleaseAssetManifestState(
    projectRef: string,
    version: string,
    state: "partial" | "failed",
    error?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ReleaseAssetManifestStateResponse> {
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    if (state !== "partial" && state !== "failed") {
      throw invalidInput("Release asset manifest state must be partial or failed");
    }
    if (error !== undefined) snapshotString(error, "Release asset manifest error");
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/asset-manifest/state`;
    logOperation("reportReleaseAssetManifestState", { state });

    const raw = await this.request(
      "reportReleaseAssetManifestState",
      url,
      {
        method: "POST",
        retryable: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          error === undefined ? { state } : { state, error: RELEASE_ASSET_FAILURE_DETAIL },
        ),
      },
      undefined,
      policy,
    );
    return parseApiResponse(
      getReleaseAssetManifestStateResponseSchema(),
      raw,
      "reportReleaseAssetManifestState",
    );
  }

  async getReleaseAssetManifest(
    projectRef: string,
    version: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ReleaseAssetManifestApiResponse> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const project = snapshotString(projectRef, "Project reference");
    const release = snapshotString(version, "Release version");
    const url = `/projects/${encodeURIComponent(project)}/releases/${
      encodeURIComponent(release)
    }/asset-manifest`;
    logOperation("getReleaseAssetManifest");

    const raw = await this.request(
      "getReleaseAssetManifest",
      url,
      {},
      undefined,
      policy,
    );
    return parseApiResponse(
      getReleaseAssetManifestResponseSchema(),
      raw,
      "getReleaseAssetManifest",
    );
  }

  private request(
    operation: ApiOperation,
    endpoint: string,
    options: RequestOptions = {},
    apiToken?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<unknown> {
    const policy = snapshotAPIRequestPolicy(requestPolicy, this.requestPolicy);
    const requestUrl = buildApiUrl(this.apiBaseUrl, endpoint);
    const telemetry = telemetryFor(operation);
    return withSpan(
      SpanNames.API_REQUEST,
      () =>
        requestWithRetry(
          requestUrl,
          apiToken ?? this.getToken(),
          this.retryConfig,
          { ...options, ...policy, telemetry },
        ),
      telemetryAttributes(operation),
    );
  }
}
