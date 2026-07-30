import {
  assertCSSPipelineIdentity,
  assertStyleProfileHash,
  logger as baseLogger,
} from "#veryfront/utils";
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

export const STYLE_ARTIFACT_CONTENT_TYPE = "text/css; charset=utf-8";
export const MAX_STYLE_ARTIFACT_SELECTOR_CODE_UNITS = 256;

const STYLE_ARTIFACT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const STYLE_ARTIFACT_SELECTOR_CONTROL_PATTERN = /[\p{Cc}\p{Cs}]/u;
const STYLE_ARTIFACT_SELECTOR_KEYS = ["branch", "environmentName", "releaseId"] as const;
const ReflectApply = Reflect.apply;
const RegExpPrototypeTest = RegExp.prototype.test;
const StringPrototypeNormalize = String.prototype.normalize;
const StringPrototypeTrim = String.prototype.trim;

export type StyleArtifactSelector =
  | Readonly<{ branch: string; environmentName?: never; releaseId?: never }>
  | Readonly<{ branch?: never; environmentName: string; releaseId?: never }>
  | Readonly<{ branch?: never; environmentName?: never; releaseId: string }>;

/** Immutable cache/control-plane identity for exactly one source selector. */
export type StyleArtifactTuple =
  & Readonly<{
    /** Versioned identity of every compiler/optimizer input capable of changing CSS output. */
    cssPipelineIdentity: string;
    styleProfileHash: string;
  }>
  & StyleArtifactSelector;

export type ResolveStyleArtifactInput = StyleArtifactTuple;

export type EnsureStyleArtifactBuildInput =
  & StyleArtifactTuple
  & Readonly<{
    force?: boolean;
  }>;

export type UpsertStyleArtifactInput =
  & StyleArtifactTuple
  & (
    | Readonly<{
      status?: "ready";
      artifactHash: string;
      assetPath?: string;
      contentType?: string;
      etag?: string;
      buildRunId?: string;
      failureReason?: never;
    }>
    | Readonly<{
      status: "building";
      artifactHash?: never;
      assetPath?: never;
      contentType?: never;
      etag?: never;
      buildRunId: string;
      failureReason?: never;
    }>
    | Readonly<{
      status: "failed";
      artifactHash?: never;
      assetPath?: never;
      contentType?: never;
      etag?: never;
      buildRunId?: string;
      failureReason: string;
    }>
  );

type StyleArtifactResolutionTuple = StyleArtifactTuple & Readonly<{ updatedAt?: string }>;

export type ProjectStyleArtifactResolution =
  | (
    & StyleArtifactResolutionTuple
    & Readonly<{
      status: "ready";
      artifactHash: string;
      assetPath: string;
      etag: string;
      contentType: typeof STYLE_ARTIFACT_CONTENT_TYPE;
      buildRunId?: string;
    }>
  )
  | (StyleArtifactResolutionTuple & Readonly<{ status: "missing" }>)
  | (
    & StyleArtifactResolutionTuple
    & Readonly<{
      status: "building";
      buildRunId: string;
    }>
  )
  | (
    & StyleArtifactResolutionTuple
    & Readonly<{
      status: "failed";
      buildRunId?: string;
      failureReason: string;
    }>
  );

function styleArtifactProtocolError(detail: string, cause?: unknown): VeryfrontError {
  return API_CLIENT_ERROR.create({ detail, cause, status: 502 });
}

function readOwnDataProperty(input: unknown, key: string, required: boolean): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Style artifact input must be an object");
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, key);
  } catch (cause) {
    throw new TypeError(`Style artifact ${key} could not be inspected`, { cause });
  }
  if (descriptor === undefined) {
    if (!required) return undefined;
    throw new TypeError(`Style artifact ${key} must be an own data property`);
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`Style artifact ${key} must be an own data property`);
  }
  return descriptor.value;
}

function assertCanonicalStyleArtifactSelector(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STYLE_ARTIFACT_SELECTOR_CODE_UNITS ||
    ReflectApply(StringPrototypeTrim, value, []) !== value ||
    ReflectApply(StringPrototypeNormalize, value, ["NFC"]) !== value ||
    ReflectApply(RegExpPrototypeTest, STYLE_ARTIFACT_SELECTOR_CONTROL_PATTERN, [value]) === true
  ) {
    throw new TypeError(
      `${label} must be a non-empty, trimmed, NFC-normalized string without control characters and no larger than ${MAX_STYLE_ARTIFACT_SELECTOR_CODE_UNITS} code units`,
    );
  }
  return value;
}

export function assertStyleArtifactHash(value: unknown, label = "Style artifact hash"): string {
  if (
    typeof value !== "string" ||
    ReflectApply(RegExpPrototypeTest, STYLE_ARTIFACT_HASH_PATTERN, [value]) !== true
  ) {
    throw new TypeError(`${label} must be a full lowercase SHA-256 digest`);
  }
  return value;
}

/** Snapshot and validate the complete control-plane tuple without invoking accessors. */
export function createStyleArtifactTuple(input: unknown): StyleArtifactTuple {
  const cssPipelineIdentity = assertCSSPipelineIdentity(
    readOwnDataProperty(input, "cssPipelineIdentity", true),
  );
  const styleProfileHash = assertStyleProfileHash(
    readOwnDataProperty(input, "styleProfileHash", true),
  );
  const selectors = STYLE_ARTIFACT_SELECTOR_KEYS.flatMap((key) => {
    const value = readOwnDataProperty(input, key, false);
    return value === undefined ? [] : [[key, value] as const];
  });

  if (selectors.length !== 1) {
    throw new TypeError("Exactly one of branch, environmentName, or releaseId is required");
  }

  const selected = selectors[0];
  if (!selected) {
    throw new TypeError("Exactly one of branch, environmentName, or releaseId is required");
  }
  const [key, rawValue] = selected;
  const value = assertCanonicalStyleArtifactSelector(rawValue, `Style artifact ${key}`);
  if (key === "branch") {
    return Object.freeze({ cssPipelineIdentity, styleProfileHash, branch: value });
  }
  if (key === "environmentName") {
    return Object.freeze({ cssPipelineIdentity, styleProfileHash, environmentName: value });
  }
  return Object.freeze({ cssPipelineIdentity, styleProfileHash, releaseId: value });
}

function selectorEntry(tuple: StyleArtifactTuple): readonly [string, string] {
  if (tuple.branch !== undefined) return ["branch", tuple.branch];
  if (tuple.environmentName !== undefined) return ["environmentName", tuple.environmentName];
  return ["releaseId", tuple.releaseId];
}

/** Validate the control plane's complete exact echo before accepting a result. */
export function assertStyleArtifactResolutionTuple(
  resolution: unknown,
  expectedInput: unknown,
): StyleArtifactTuple {
  let expected: StyleArtifactTuple;
  let actual: StyleArtifactTuple;
  try {
    expected = createStyleArtifactTuple(expectedInput);
    actual = createStyleArtifactTuple(resolution);
  } catch (cause) {
    throw styleArtifactProtocolError(
      "Veryfront API returned an invalid style artifact tuple",
      cause,
    );
  }

  const [expectedKey, expectedValue] = selectorEntry(expected);
  const [actualKey, actualValue] = selectorEntry(actual);
  if (
    actual.cssPipelineIdentity !== expected.cssPipelineIdentity ||
    actual.styleProfileHash !== expected.styleProfileHash ||
    actualKey !== expectedKey ||
    actualValue !== expectedValue
  ) {
    throw styleArtifactProtocolError(
      "Veryfront API style artifact response tuple did not match the request",
    );
  }
  return actual;
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

function buildStyleArtifactParams(
  tuple: StyleArtifactTuple,
): URLSearchParams {
  const params = new URLSearchParams({
    css_pipeline_identity: tuple.cssPipelineIdentity,
    style_profile_hash: tuple.styleProfileHash,
  });

  if (tuple.branch !== undefined) params.set("branch", tuple.branch);
  if (tuple.environmentName !== undefined) params.set("environment_name", tuple.environmentName);
  if (tuple.releaseId !== undefined) params.set("release_id", tuple.releaseId);

  return params;
}

function serializeStyleArtifactTuple(tuple: StyleArtifactTuple): Record<string, string> {
  const wire: Record<string, string> = {
    css_pipeline_identity: tuple.cssPipelineIdentity,
    style_profile_hash: tuple.styleProfileHash,
  };
  if (tuple.branch !== undefined) wire.branch = tuple.branch;
  if (tuple.environmentName !== undefined) wire.environment_name = tuple.environmentName;
  if (tuple.releaseId !== undefined) wire.release_id = tuple.releaseId;
  return wire;
}

function responseTuple(response: {
  css_pipeline_identity: string;
  style_profile_hash: string;
  branch?: string;
  environment_name?: string;
  release_id?: string;
}): StyleArtifactTuple {
  return createStyleArtifactTuple({
    cssPipelineIdentity: response.css_pipeline_identity,
    styleProfileHash: response.style_profile_hash,
    ...(response.branch === undefined ? {} : { branch: response.branch }),
    ...(response.environment_name === undefined
      ? {}
      : { environmentName: response.environment_name }),
    ...(response.release_id === undefined ? {} : { releaseId: response.release_id }),
  });
}

const STYLE_ARTIFACT_RESPONSE_COMMON_KEYS = new Set([
  "status",
  "css_pipeline_identity",
  "style_profile_hash",
  "branch",
  "environment_name",
  "release_id",
  "updated_at",
]);

function assertExactStyleArtifactResponseShape(raw: unknown): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw styleArtifactProtocolError("Veryfront API returned an invalid style artifact response");
  }
  let status: unknown;
  let keys: PropertyKey[];
  try {
    status = readOwnDataProperty(raw, "status", true);
    keys = Reflect.ownKeys(raw);
  } catch (cause) {
    throw styleArtifactProtocolError(
      "Veryfront API style artifact response could not be inspected",
      cause,
    );
  }
  const statusKeys = status === "ready"
    ? ["artifact_hash", "asset_path", "etag", "content_type", "build_run_id"]
    : status === "building"
    ? ["build_run_id"]
    : status === "failed"
    ? ["build_run_id", "failure_reason"]
    : status === "missing"
    ? []
    : null;
  if (statusKeys === null) {
    throw styleArtifactProtocolError("Veryfront API returned an invalid style artifact status");
  }
  const allowed = new Set([...STYLE_ARTIFACT_RESPONSE_COMMON_KEYS, ...statusKeys]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw styleArtifactProtocolError(
      `Veryfront API returned fields that are invalid for style artifact status ${status}`,
    );
  }
}

function assertCanonicalReadyArtifact(response: {
  artifact_hash: string;
  asset_path: string;
  content_type: string;
  etag: string;
}): string {
  const hash = assertStyleArtifactHash(response.artifact_hash);
  const expectedPath = `/_vf/css/${hash}.css`;
  if (response.asset_path !== expectedPath) {
    throw new TypeError(`Style artifact path must be ${expectedPath}`);
  }
  if (response.content_type !== STYLE_ARTIFACT_CONTENT_TYPE) {
    throw new TypeError(`Style artifact content type must be ${STYLE_ARTIFACT_CONTENT_TYPE}`);
  }
  if (response.etag !== `"${hash}"`) {
    throw new TypeError(`Style artifact ETag must quote the artifact hash`);
  }
  return hash;
}

function mapStyleArtifactResolution(
  raw: unknown,
  expectedTuple: StyleArtifactTuple,
  expectedStatus?: "ready" | "building" | "failed",
  expectedArtifactHash?: string,
): ProjectStyleArtifactResolution {
  assertExactStyleArtifactResponseShape(raw);
  let response;
  try {
    response = getStyleArtifactResolveResponseSchema().parse(raw);
  } catch (cause) {
    throw styleArtifactProtocolError(
      "Veryfront API returned an invalid style artifact resolution",
      cause,
    );
  }
  let tuple: StyleArtifactTuple;
  try {
    tuple = responseTuple(response);
  } catch (cause) {
    throw styleArtifactProtocolError("Veryfront API returned a non-canonical style tuple", cause);
  }
  assertStyleArtifactResolutionTuple(tuple, expectedTuple);
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw styleArtifactProtocolError(
      `Veryfront API PUT response status ${response.status} did not acknowledge requested status ${expectedStatus}`,
    );
  }

  const common = {
    ...tuple,
    ...(response.updated_at === undefined ? {} : { updatedAt: response.updated_at }),
  };
  try {
    if (response.status === "ready") {
      const artifactHash = assertCanonicalReadyArtifact(response);
      if (expectedArtifactHash !== undefined && artifactHash !== expectedArtifactHash) {
        throw new TypeError("PUT response artifact hash did not match the requested artifact hash");
      }
      return Object.freeze({
        ...common,
        status: "ready" as const,
        artifactHash,
        assetPath: response.asset_path,
        contentType: STYLE_ARTIFACT_CONTENT_TYPE,
        etag: response.etag,
        ...(response.build_run_id === undefined ? {} : {
          buildRunId: assertCanonicalStyleArtifactSelector(
            response.build_run_id,
            "Style artifact build run id",
          ),
        }),
      });
    }
    if (response.status === "building") {
      const buildRunId = assertCanonicalStyleArtifactSelector(
        response.build_run_id,
        "Style artifact build run id",
      );
      return Object.freeze({ ...common, status: "building" as const, buildRunId });
    }
    if (response.status === "failed") {
      if (response.failure_reason.length === 0) {
        throw new TypeError("Style artifact failure reason must not be empty");
      }
      return Object.freeze({
        ...common,
        status: "failed" as const,
        failureReason: response.failure_reason,
        ...(response.build_run_id === undefined ? {} : {
          buildRunId: assertCanonicalStyleArtifactSelector(
            response.build_run_id,
            "Style artifact build run id",
          ),
        }),
      });
    }
    return Object.freeze({ ...common, status: "missing" as const });
  } catch (cause) {
    throw styleArtifactProtocolError(
      `Veryfront API returned invalid ${response.status} style artifact metadata`,
      cause,
    );
  }
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
    const tuple = createStyleArtifactTuple(input);
    const params = buildStyleArtifactParams(tuple);
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current?${params}`;
    logger.debug("resolveStyleArtifact", {
      projectRef,
      ...tuple,
    });

    return mapStyleArtifactResolution(
      await this.request(url),
      tuple,
    );
  }

  async ensureStyleArtifactBuild(
    projectRef: string,
    input: EnsureStyleArtifactBuildInput,
  ): Promise<ProjectStyleArtifactResolution> {
    const tuple = createStyleArtifactTuple(input);
    const force = readOwnDataProperty(input, "force", false);
    if (force !== undefined && typeof force !== "boolean") {
      throw new TypeError("Style artifact force must be a boolean");
    }
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current/builds`;
    logger.debug("ensureStyleArtifactBuild", {
      projectRef,
      ...tuple,
      force: force ?? false,
    });

    return mapStyleArtifactResolution(
      await this.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...serializeStyleArtifactTuple(tuple),
          force: force ?? false,
        }),
      }),
      tuple,
    );
  }

  async upsertStyleArtifact(
    projectRef: string,
    input: UpsertStyleArtifactInput,
  ): Promise<ProjectStyleArtifactResolution> {
    const tuple = createStyleArtifactTuple(input);
    const status = readOwnDataProperty(input, "status", false) ?? "ready";
    if (status !== "ready" && status !== "building" && status !== "failed") {
      throw new TypeError("Style artifact status must be ready, building, or failed");
    }

    let expectedArtifactHash: string | undefined;
    let statusFields: Record<string, string>;
    if (status === "ready") {
      expectedArtifactHash = assertStyleArtifactHash(
        readOwnDataProperty(input, "artifactHash", true),
      );
      const canonical = {
        assetPath: `/_vf/css/${expectedArtifactHash}.css`,
        contentType: STYLE_ARTIFACT_CONTENT_TYPE,
        etag: `"${expectedArtifactHash}"`,
      };
      for (const key of ["assetPath", "contentType", "etag"] as const) {
        const supplied = readOwnDataProperty(input, key, false);
        if (supplied !== undefined && supplied !== canonical[key]) {
          throw new TypeError(`Style artifact ${key} must be ${canonical[key]}`);
        }
      }
      const buildRunId = readOwnDataProperty(input, "buildRunId", false);
      statusFields = {
        artifact_hash: expectedArtifactHash,
        asset_path: canonical.assetPath,
        content_type: canonical.contentType,
        etag: canonical.etag,
        ...(buildRunId === undefined ? {} : {
          build_run_id: assertCanonicalStyleArtifactSelector(
            buildRunId,
            "Style artifact build run id",
          ),
        }),
      };
    } else if (status === "building") {
      statusFields = {
        build_run_id: assertCanonicalStyleArtifactSelector(
          readOwnDataProperty(input, "buildRunId", true),
          "Style artifact build run id",
        ),
      };
    } else {
      const failureReason = readOwnDataProperty(input, "failureReason", true);
      if (typeof failureReason !== "string" || failureReason.length === 0) {
        throw new TypeError("Style artifact failure reason must not be empty");
      }
      const buildRunId = readOwnDataProperty(input, "buildRunId", false);
      statusFields = {
        failure_reason: failureReason,
        ...(buildRunId === undefined ? {} : {
          build_run_id: assertCanonicalStyleArtifactSelector(
            buildRunId,
            "Style artifact build run id",
          ),
        }),
      };
    }
    const url = `/projects/${encodeURIComponent(projectRef)}/style-artifacts/current`;
    logger.debug("upsertStyleArtifact", {
      projectRef,
      ...tuple,
      status,
      artifactHash: expectedArtifactHash,
    });

    return mapStyleArtifactResolution(
      await this.request(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...serializeStyleArtifactTuple(tuple),
          status,
          ...statusFields,
        }),
      }),
      tuple,
      status,
      expectedArtifactHash,
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
