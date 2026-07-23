import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type EnsureStyleArtifactBuildInput,
  type FileDetail,
  type FileListResult,
  type ListAllFilesOptions,
  type ListFilesOptions,
  type ProjectStyleArtifactResolution,
  type ResolveStyleArtifactInput,
  type TokenProvider,
  type UpsertStyleArtifactInput,
  VeryfrontAPIOperations,
} from "./operations.ts";
import {
  type ResolvedVeryfrontAPIRequestPolicy,
  snapshotAPIRequestPolicy,
  validateRetryConfig,
} from "./retry-handler.ts";
import type { Project } from "./schemas/index.ts";
import {
  API_CLIENT_ERROR,
  type FileContext,
  type VeryfrontAPIConfig,
  type VeryfrontAPIRequestPolicy,
  VeryfrontError,
} from "./types.ts";

export type { FileContext } from "./types.ts";

const logger = baseLogger.component("veryfront-api-client");

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const INITIALIZATION_ROUTE = "/projects/{project}";

type InitializationStage =
  | "called"
  | "waiting"
  | "waitComplete"
  | "alreadyInitialized"
  | "started"
  | "usingConfiguredProjectId"
  | "requestStarted"
  | "requestComplete"
  | "complete";

interface InitializationLogContext {
  durationMs?: number;
  initialized?: boolean;
  pending?: boolean;
}

function validateToken(
  value: unknown,
  source: "API" | "request" | "request-context" | "request identity",
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw API_CLIENT_ERROR.create({
      detail: `${source} token must be a non-empty string`,
      status: 401,
    });
  }
  try {
    new Headers({ Authorization: `Bearer ${value}` });
  } catch (_) {
    throw API_CLIENT_ERROR.create({ detail: `${source} token is invalid`, status: 401 });
  }
  return value;
}

function validateRequestProjectSlug(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw API_CLIENT_ERROR.create({
      detail: "request project slug must be a non-empty string",
      status: 400,
    });
  }
  return value;
}

function invalidConfig(detail: string): VeryfrontError {
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
    throw invalidConfig(`${label} must be an object`);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch (_) {
    throw invalidConfig(`${label} could not be read`);
  }
  if (isArray) throw invalidConfig(`${label} must be an object`);
  const snapshot: Record<string, unknown> = {};
  try {
    for (const property of properties) snapshot[property] = Reflect.get(value, property);
  } catch (_) {
    throw invalidConfig(`${label} could not be read`);
  }
  return snapshot;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalidConfig(`${label} must be a string`);
  return value;
}

interface ResolvedVeryfrontAPIConfig extends VeryfrontAPIConfig {
  readonly retry: Required<NonNullable<VeryfrontAPIConfig["retry"]>>;
  readonly requestPolicy: Readonly<ResolvedVeryfrontAPIRequestPolicy>;
}

function snapshotConfig(config: unknown): Readonly<ResolvedVeryfrontAPIConfig> {
  const values = snapshotProperties(config, "Veryfront API configuration", [
    "apiBaseUrl",
    "apiToken",
    "requestTokenProvider",
    "requestIdentityProvider",
    "projectSlug",
    "projectId",
    "proxyMode",
    "retry",
    "requestPolicy",
  ]);
  if (typeof values.apiBaseUrl !== "string") {
    throw invalidConfig("Veryfront API base URL must be a string");
  }
  // Proxy adapters historically pass an empty string for an unavailable
  // static credential. Treat that sentinel as absent, then fail closed if no
  // request-scoped credential is available when an operation starts.
  const apiToken = values.apiToken === undefined || values.apiToken === ""
    ? undefined
    : validateToken(values.apiToken, "API");
  const projectSlug = values.projectSlug === undefined || values.projectSlug === ""
    ? undefined
    : validateRequestProjectSlug(values.projectSlug);
  const projectId = optionalString(values.projectId, "Veryfront API project ID");
  if (
    values.requestTokenProvider !== undefined && typeof values.requestTokenProvider !== "function"
  ) {
    throw invalidConfig("Veryfront API request token provider must be a function");
  }
  if (
    values.requestIdentityProvider !== undefined &&
    typeof values.requestIdentityProvider !== "function"
  ) {
    throw invalidConfig("Veryfront API request identity provider must be a function");
  }
  if (values.proxyMode !== undefined && typeof values.proxyMode !== "boolean") {
    throw invalidConfig("Veryfront API proxyMode must be a boolean");
  }

  const rawRetry = values.retry === undefined
    ? {}
    : snapshotProperties(values.retry, "Veryfront API retry configuration", [
      "maxRetries",
      "initialDelay",
      "maxDelay",
    ]);
  const retry = Object.freeze({
    maxRetries: rawRetry.maxRetries === undefined ? DEFAULT_MAX_RETRIES : rawRetry.maxRetries,
    initialDelay: rawRetry.initialDelay === undefined
      ? DEFAULT_INITIAL_RETRY_DELAY_MS
      : rawRetry.initialDelay,
    maxDelay: rawRetry.maxDelay === undefined ? DEFAULT_MAX_RETRY_DELAY_MS : rawRetry.maxDelay,
  }) as Required<NonNullable<VeryfrontAPIConfig["retry"]>>;
  validateRetryConfig(retry);

  return Object.freeze({
    apiBaseUrl: values.apiBaseUrl,
    apiToken,
    requestTokenProvider: values.requestTokenProvider as VeryfrontAPIConfig["requestTokenProvider"],
    requestIdentityProvider: values
      .requestIdentityProvider as VeryfrontAPIConfig["requestIdentityProvider"],
    projectSlug,
    projectId,
    proxyMode: values.proxyMode as boolean | undefined,
    retry,
    requestPolicy: snapshotAPIRequestPolicy(values.requestPolicy),
  });
}

function validateFileContext(value: unknown): FileContext {
  const type = snapshotProperties(value, "File context", ["type"]).type;
  if (type === "branch" || type === "environment") {
    const name = snapshotProperties(value, "File context", ["name"]).name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw API_CLIENT_ERROR.create({
        detail: `${type} file context name must be a non-empty string`,
        status: 400,
      });
    }
    return Object.freeze({ type, name });
  }
  if (type === "release") {
    const version = snapshotProperties(value, "File context", ["version"]).version;
    if (typeof version !== "string" || version.trim().length === 0) {
      throw API_CLIENT_ERROR.create({
        detail: "release file context version must be a non-empty string",
        status: 400,
      });
    }
    return Object.freeze({ type: "release", version });
  }

  throw API_CLIENT_ERROR.create({
    detail: "file context type is invalid",
    status: 400,
  });
}

function logInitialization(
  stage: InitializationStage,
  context: InitializationLogContext = {},
): void {
  logger.debug("Veryfront API client initialization", {
    operation: "initialize",
    route: INITIALIZATION_ROUTE,
    stage,
    ...context,
  });
}

interface ResolvedRequestIdentity {
  readonly token: string;
  readonly projectSlug: string | undefined;
  readonly fileContext: FileContext;
  readonly requestScoped: boolean;
}

interface ScopedOperation {
  readonly identity: ResolvedRequestIdentity;
  readonly operations: VeryfrontAPIOperations;
}

export interface VeryfrontAPIInitializationResult {
  readonly projectId: string;
  readonly project?: Project;
  readonly requestScoped: boolean;
}

export class VeryfrontApiClient {
  private readonly config: Readonly<ResolvedVeryfrontAPIConfig>;
  private operations: VeryfrontAPIOperations;
  private requestToken?: string;
  private requestProjectSlug?: string;
  private requestContext?: FileContext;
  private requestBranch?: string | null;
  private initialized = false;
  private readonly pendingInitializations = new Map<
    string,
    Promise<VeryfrontAPIInitializationResult>
  >();
  private initializationGeneration = 0;
  /** Cached project data from initialization - avoids redundant API calls */
  private cachedProjectData?: Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>>;

  constructor(config: VeryfrontAPIConfig) {
    this.config = snapshotConfig(config);

    const tokenProvider: TokenProvider = () => this.resolveRequestIdentity().token;

    this.operations = new VeryfrontAPIOperations(
      this.config.apiBaseUrl,
      tokenProvider,
      this.config.retry,
      undefined,
      this.config.requestPolicy,
    );
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  private resolveProvidedRequestIdentity(): ResolvedRequestIdentity | undefined {
    const provider = this.config.requestIdentityProvider;
    if (!provider) return undefined;

    try {
      const provided = provider();
      if (provided === undefined) return undefined;
      if (!provided || typeof provided !== "object") {
        throw API_CLIENT_ERROR.create({
          detail: "request identity must be an object",
          status: 400,
        });
      }
      const identity = snapshotProperties(provided, "Veryfront API request identity", [
        "token",
        "projectSlug",
        "fileContext",
      ]);
      const token = validateToken(identity.token, "request identity");
      const projectSlug = validateRequestProjectSlug(identity.projectSlug);
      const fileContext = identity.fileContext === undefined
        ? Object.freeze({ type: "branch", name: "main" } as const)
        : validateFileContext(identity.fileContext);

      return Object.freeze({
        token,
        projectSlug,
        fileContext,
        requestScoped: true,
      });
    } catch (error) {
      if (isApiClientError(error)) throw error;
      throw API_CLIENT_ERROR.create({
        detail: "Unable to resolve the Veryfront API request identity",
        status: 401,
      });
    }
  }

  private resolveRequestIdentity(): ResolvedRequestIdentity {
    const providedIdentity = this.resolveProvidedRequestIdentity();
    if (providedIdentity) return providedIdentity;

    try {
      const contextToken = this.config.requestTokenProvider?.();
      if (contextToken !== undefined) {
        return Object.freeze({
          token: validateToken(contextToken, "request-context"),
          projectSlug: this.getLegacyProjectSlug(),
          fileContext: this.getLegacyContext(),
          requestScoped: true,
        });
      }
      if (this.requestToken !== undefined) {
        return Object.freeze({
          token: validateToken(this.requestToken, "request"),
          projectSlug: this.getLegacyProjectSlug(),
          fileContext: this.getLegacyContext(),
          requestScoped: false,
        });
      }
      if (this.config.apiToken !== undefined) {
        return Object.freeze({
          token: validateToken(this.config.apiToken, "API"),
          projectSlug: this.getLegacyProjectSlug(),
          fileContext: this.getLegacyContext(),
          requestScoped: false,
        });
      }
    } catch (error) {
      if (isApiClientError(error)) throw error;
      throw API_CLIENT_ERROR.create({
        detail: "Unable to resolve the Veryfront API token",
        status: 401,
      });
    }
    throw API_CLIENT_ERROR.create({ detail: "No API token available", status: 401 });
  }

  private createScopedOperation(requestPolicy?: VeryfrontAPIRequestPolicy): ScopedOperation {
    const identity = this.resolveRequestIdentity();
    return {
      identity,
      operations: new VeryfrontAPIOperations(
        this.config.apiBaseUrl,
        identity.token,
        this.config.retry,
        undefined,
        snapshotAPIRequestPolicy(requestPolicy, this.config.requestPolicy),
      ),
    };
  }

  private getLegacyProjectSlug(): string | undefined {
    return this.requestProjectSlug ?? this.config.projectSlug;
  }

  private getLegacyContext(): FileContext {
    return this.requestContext ?? { type: "branch", name: "main" };
  }

  isProxyMode(): boolean {
    return this.config.proxyMode === true;
  }

  /**
   * Set a mutable request token for legacy single-request clients.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  setRequestToken(token: string): void {
    const validated = validateToken(token, "request");
    if (validated === this.requestToken) return;
    this.requestToken = validated;
    this.invalidateProjectIdentity();
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  clearRequestToken(): void {
    if (this.requestToken === undefined) return;
    this.requestToken = undefined;
    this.invalidateProjectIdentity();
  }

  /**
   * Set a mutable project slug for legacy single-request clients.
   *
   * @deprecated Use requestIdentityProvider when a client can serve concurrent requests.
   */
  setProjectSlug(slug: string): void {
    const validated = validateRequestProjectSlug(slug);
    const previousSlug = this.getLegacyProjectSlug();
    this.requestProjectSlug = validated;
    if (validated !== previousSlug) this.invalidateProjectIdentity();
  }

  getProjectSlug(): string | undefined {
    return this.resolveProvidedRequestIdentity()?.projectSlug ?? this.getLegacyProjectSlug();
  }

  /** Throws a structured error when no project slug is configured, instead of passing `undefined` to API calls. */
  private requireProjectSlug(identity: ResolvedRequestIdentity): string {
    const slug = identity.projectSlug;
    if (!slug) {
      throw API_CLIENT_ERROR.create({
        detail:
          "No project slug configured. Call setProjectSlug() or provide projectSlug in the config before making project-scoped API calls",
        status: 400,
      });
    }
    return slug;
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  clearProjectSlug(): void {
    const previousSlug = this.getLegacyProjectSlug();
    this.requestProjectSlug = undefined;
    if (this.getLegacyProjectSlug() !== previousSlug) this.invalidateProjectIdentity();
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  setContext(context: FileContext): void {
    this.requestContext = validateFileContext(context);
  }

  getContext(): FileContext {
    return this.resolveProvidedRequestIdentity()?.fileContext ?? this.getLegacyContext();
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  clearContext(): void {
    this.requestContext = undefined;
  }

  getToken(): string {
    return this.resolveRequestIdentity().token;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  setRequestBranch(branch: string | null): void {
    if (branch !== null) {
      const context = validateFileContext({ type: "branch", name: branch });
      this.requestBranch = branch;
      this.requestContext = context;
      return;
    }

    this.requestBranch = null;
    this.clearContext();
  }

  getRequestBranch(): string | null | undefined {
    return this.requestBranch;
  }

  /** @deprecated Use requestIdentityProvider when a client can serve concurrent requests. */
  clearRequestBranch(): void {
    this.requestBranch = undefined;
    this.clearContext();
  }

  // =============================================================================
  // Initialization
  // =============================================================================

  async initialize(requestPolicy?: VeryfrontAPIRequestPolicy): Promise<void> {
    await this.initializeProject(requestPolicy);
  }

  /**
   * Initialize project access and return the project identity for this call.
   * Request-scoped results are returned to the caller without being published
   * to the client-wide initialized state.
   */
  async initializeProject(
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<VeryfrontAPIInitializationResult> {
    logInitialization("called", {
      initialized: this.initialized,
      pending: this.pendingInitializations.size > 0,
    });

    const operation = this.createScopedOperation(requestPolicy);
    const slug = operation.identity.projectSlug;
    if (!slug) {
      throw API_CLIENT_ERROR.create({
        detail: "No project slug available for initialization",
        status: 400,
      });
    }
    const { token, requestScoped } = operation.identity;
    // Only callers using the same configured policy can safely share network
    // work. A per-call signal, timeout, or response limit must remain
    // authoritative for that caller.
    const initializationKey = requestPolicy === undefined
      ? JSON.stringify([requestScoped, slug, token])
      : undefined;
    const pendingInitialization = initializationKey === undefined
      ? undefined
      : this.pendingInitializations.get(initializationKey);

    if (pendingInitialization) {
      logInitialization("waiting");
      const waitStart = performance.now();
      const result = await pendingInitialization;
      logInitialization("waitComplete", {
        durationMs: Math.round(performance.now() - waitStart),
      });
      return result;
    }

    if (this.initialized && !requestScoped) {
      logInitialization("alreadyInitialized");
      return {
        projectId: this.operations.getProjectId(),
        project: this.cachedProjectData,
        requestScoped: false,
      };
    }

    const generation = this.initializationGeneration;
    const initialization = this.doInitialize(generation, slug, operation);
    if (initializationKey !== undefined) {
      this.pendingInitializations.set(initializationKey, initialization);
    }
    try {
      return await initialization;
    } finally {
      if (
        initializationKey !== undefined &&
        this.pendingInitializations.get(initializationKey) === initialization
      ) {
        this.pendingInitializations.delete(initializationKey);
      }
    }
  }

  private async doInitialize(
    generation: number,
    slug: string,
    operation: ScopedOperation,
  ): Promise<VeryfrontAPIInitializationResult> {
    const initStartTime = performance.now();
    logInitialization("started");
    const { requestScoped } = operation.identity;

    const configuredProjectId = this.config.projectSlug === slug
      ? this.config.projectId
      : undefined;
    if (configuredProjectId) {
      logInitialization("usingConfiguredProjectId", {
        durationMs: Math.round(performance.now() - initStartTime),
      });
      if (!requestScoped && generation === this.initializationGeneration) {
        this.operations.setProjectId(configuredProjectId);
        this.initialized = true;
      }
      return { projectId: configuredProjectId, requestScoped };
    }

    // Use getProject directly instead of listProjects - more efficient and works
    // with tokens that have project access but not list access
    logInitialization("requestStarted");
    const getProjectStart = performance.now();
    const project = await operation.operations.getProjectForInitialization(slug);
    logInitialization("requestComplete", {
      durationMs: Math.round(performance.now() - getProjectStart),
    });

    if (!requestScoped && generation === this.initializationGeneration) {
      this.cachedProjectData = project;
      this.operations.setProjectId(project.id);
      this.initialized = true;
    }
    logInitialization("complete", {
      durationMs: Math.round(performance.now() - initStartTime),
    });
    return { projectId: project.id, project, requestScoped };
  }

  reset(): void {
    this.invalidateProjectIdentity();
  }

  private invalidateProjectIdentity(): void {
    this.initializationGeneration++;
    this.initialized = false;
    this.pendingInitializations.clear();
    this.cachedProjectData = undefined;
    this.operations.setProjectId("");
  }

  getProjectId(): string {
    return this.operations.getProjectId();
  }

  /**
   * Get the cached project data from initialization.
   * Returns undefined if not yet initialized or if projectId was provided in config.
   * Use this instead of calling getProject() to avoid redundant API calls.
   */
  getCachedProject(): Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>> | undefined {
    return this.cachedProjectData;
  }

  // =============================================================================
  // Project Operations
  // =============================================================================

  listProjects(requestPolicy?: VeryfrontAPIRequestPolicy) {
    return this.createScopedOperation(requestPolicy).operations.listProjects();
  }

  getProject(projectRef?: string, requestPolicy?: VeryfrontAPIRequestPolicy) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.getProject(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
    );
  }

  // =============================================================================
  // File Operations (context-aware)
  // =============================================================================

  listFiles(
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileListResult> {
    const operation = this.createScopedOperation(requestPolicy);
    return this.listFilesByContext(
      operation.operations,
      this.requireProjectSlug(operation.identity),
      operation.identity.fileContext,
      options,
    );
  }

  listAllFiles(
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    const projectRef = this.requireProjectSlug(operation.identity);
    const context = operation.identity.fileContext;

    switch (context.type) {
      case "branch":
        return operation.operations.listAllBranchFiles(projectRef, context.name, options);
      case "environment":
        return operation.operations.listAllEnvironmentFiles(projectRef, context.name, options);
      case "release":
        return operation.operations.listAllReleaseFiles(projectRef, context.version, options);
    }
  }

  getFile(
    pathOrId: string,
    options: { expectedMissing?: boolean } = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<FileDetail> {
    const operation = this.createScopedOperation(requestPolicy);
    const projectRef = this.requireProjectSlug(operation.identity);
    const context = operation.identity.fileContext;

    switch (context.type) {
      case "branch":
        return operation.operations.getBranchFile(projectRef, context.name, pathOrId, options);
      case "environment":
        return operation.operations.getEnvironmentFile(projectRef, context.name, pathOrId, options);
      case "release":
        return operation.operations.getReleaseFile(projectRef, context.version, pathOrId, options);
    }
  }

  async getFileContent(
    pathOrId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<string> {
    const file = await this.getFile(pathOrId, {}, requestPolicy);
    return file.content;
  }

  async getOptionalFileContent(
    pathOrId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<string> {
    const file = await this.getFile(pathOrId, { expectedMissing: true }, requestPolicy);
    return file.content;
  }

  // =============================================================================
  // Branch-specific Operations
  // =============================================================================

  listBranchFiles(
    branchName = "main",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.listBranchFiles(
      this.requireProjectSlug(operation.identity),
      branchName,
      options,
    );
  }

  getBranchFile(
    branchName: string,
    pathOrId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.getBranchFile(
      this.requireProjectSlug(operation.identity),
      branchName,
      pathOrId,
    );
  }

  // =============================================================================
  // Environment-specific Operations
  // =============================================================================

  listEnvironmentFiles(
    environmentName = "production",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.listEnvironmentFiles(
      this.requireProjectSlug(operation.identity),
      environmentName,
      options,
    );
  }

  listAllEnvironmentFiles(
    environmentName = "production",
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.listAllEnvironmentFiles(
      this.requireProjectSlug(operation.identity),
      environmentName,
      options,
    );
  }

  getEnvironmentFile(
    environmentName: string,
    pathOrId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.getEnvironmentFile(
      this.requireProjectSlug(operation.identity),
      environmentName,
      pathOrId,
    );
  }

  // =============================================================================
  // Release-specific Operations
  // =============================================================================

  listReleaseFiles(
    version = "latest",
    options: ListFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.listReleaseFiles(
      this.requireProjectSlug(operation.identity),
      version,
      options,
    );
  }

  listAllReleaseFiles(
    version = "latest",
    options: ListAllFilesOptions = {},
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.listAllReleaseFiles(
      this.requireProjectSlug(operation.identity),
      version,
      options,
    );
  }

  getReleaseFile(
    version: string,
    pathOrId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.getReleaseFile(
      this.requireProjectSlug(operation.identity),
      version,
      pathOrId,
    );
  }

  // =============================================================================
  // Domain Lookup
  // =============================================================================

  lookupProjectByDomain(domain: string, requestPolicy?: VeryfrontAPIRequestPolicy) {
    return this.createScopedOperation(requestPolicy).operations.lookupProjectByDomain(domain);
  }

  resolveStyleArtifact(
    input: ResolveStyleArtifactInput,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.resolveStyleArtifact(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      input,
    );
  }

  ensureStyleArtifactBuild(
    input: EnsureStyleArtifactBuildInput,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.ensureStyleArtifactBuild(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      input,
    );
  }

  upsertStyleArtifact(
    input: UpsertStyleArtifactInput,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<ProjectStyleArtifactResolution> {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.upsertStyleArtifact(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      input,
    );
  }

  // =============================================================================
  // Release Asset Manifest Operations
  // =============================================================================

  beginReleaseAssetManifestBuild(
    version: string,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.beginReleaseAssetManifestBuild(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      version,
    );
  }

  uploadReleaseAsset(
    version: string,
    contentHash: string,
    contentType: string,
    bytes: Uint8Array,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.uploadReleaseAsset(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      version,
      contentHash,
      contentType,
      bytes,
    );
  }

  putReleaseAssetManifest(
    version: string,
    manifest: unknown,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.putReleaseAssetManifest(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      version,
      manifest,
    );
  }

  reportReleaseAssetManifestState(
    version: string,
    state: "partial" | "failed",
    error?: string,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.reportReleaseAssetManifestState(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      version,
      state,
      error,
    );
  }

  getReleaseAssetManifest(
    version: string,
    projectRef?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    return operation.operations.getReleaseAssetManifest(
      projectRef === undefined ? this.requireProjectSlug(operation.identity) : projectRef,
      version,
    );
  }

  // =============================================================================
  // Adapter Convenience Methods
  // =============================================================================

  async getFileById(
    entityId: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<{ path: string; content: string } | null> {
    try {
      const file = await this.getFile(entityId, {}, requestPolicy);
      return { path: file.path, content: file.content };
    } catch (error) {
      if (isApiClientError(error) && error.status === 404) return null;
      throw error;
    }
  }

  async searchFiles(
    pattern: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<{ id?: string; path: string }[]> {
    const files = await this.listAllFiles({ pattern }, requestPolicy);
    return files.map((file) => ({ id: file.id, path: file.path }));
  }

  /**
   * Search for files matching a pattern and return them with content.
   * Useful for batch-loading files without knowing exact extensions.
   *
   * Example: searchFilesWithContent("components/Button.*") returns all files
   * like Button.tsx, Button.ts, Button.jsx etc. with their content.
   *
   * @param pattern - Glob pattern to match files (e.g., "path/file.*" or "pages/_error.*")
   * @returns Array of files with path and content
   */
  async searchFilesWithContent(
    pattern: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<Array<{ path: string; content: string }>> {
    const files = await this.listAllFiles({ pattern }, requestPolicy);
    return files.map((file) => {
      if (file.content === undefined) {
        throw API_CLIENT_ERROR.create({
          detail: "Veryfront API returned a search result without content",
          status: 502,
        });
      }
      return { path: file.path, content: file.content };
    });
  }

  private listFilesByContext(
    operations: VeryfrontAPIOperations,
    projectRef: string,
    context: FileContext,
    options: ListFilesOptions,
  ): Promise<FileListResult> {
    switch (context.type) {
      case "branch":
        return operations.listBranchFiles(projectRef, context.name, options);
      case "environment":
        return operations.listEnvironmentFiles(projectRef, context.name, options);
      case "release":
        return operations.listReleaseFiles(projectRef, context.version, options);
    }
  }

  /**
   * Resolve a file path without extension by searching for all possible extensions.
   * Returns the first match based on extension priority.
   *
   * @param basePath - Path without extension (e.g., "components/Button")
   * @param extensionPriority - Preferred extension order (default: .tsx, .ts, .jsx, .js, .mdx, .md)
   * @returns The resolved file with content, or null if not found
   */
  async resolveFileWithExtension(
    basePath: string,
    extensionPriority = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"],
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<{ path: string; content: string } | null> {
    if (typeof basePath !== "string") throw invalidConfig("File base path must be a string");
    let extensionsAreArray = false;
    try {
      extensionsAreArray = Array.isArray(extensionPriority);
    } catch (_) {
      throw invalidConfig("File extension priority could not be read");
    }
    if (!extensionsAreArray) {
      throw invalidConfig("File extension priority must be an array");
    }
    let extensions: string[];
    try {
      extensions = Array.from(extensionPriority, (extension: unknown) => {
        if (typeof extension !== "string") {
          throw invalidConfig("File extension priority values must be strings");
        }
        return extension;
      }) as string[];
    } catch (error) {
      if (isApiClientError(error)) throw error;
      throw invalidConfig("File extension priority could not be read");
    }
    const matches = await this.searchFilesWithContent(`${basePath}.*`, requestPolicy);
    if (matches.length === 0) return null;

    matches.sort((a, b) => {
      const extA = extensions.findIndex((ext) => a.path.endsWith(ext));
      const extB = extensions.findIndex((ext) => b.path.endsWith(ext));
      return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
    });

    return matches[0] ?? null;
  }

  listPublishedFiles(
    _projectId?: string,
    releaseId?: string,
    environmentName?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ) {
    const operation = this.createScopedOperation(requestPolicy);
    const projectRef = this.requireProjectSlug(operation.identity);

    if (releaseId) {
      return operation.operations.listAllReleaseFiles(projectRef, releaseId);
    }

    if (environmentName) {
      return operation.operations.listAllEnvironmentFiles(projectRef, environmentName);
    }

    throw API_CLIENT_ERROR.create({
      detail: "Cannot list published files without releaseId or environmentName",
      status: 400,
    });
  }

  async getPublishedFileContent(
    path: string,
    releaseId?: string,
    environmentName?: string,
    requestPolicy?: VeryfrontAPIRequestPolicy,
  ): Promise<string> {
    const operation = this.createScopedOperation(requestPolicy);
    const projectRef = this.requireProjectSlug(operation.identity);

    if (releaseId) {
      const result = await operation.operations.getReleaseFile(projectRef, releaseId, path);
      return result.content;
    }

    if (environmentName) {
      const result = await operation.operations.getEnvironmentFile(
        projectRef,
        environmentName,
        path,
      );
      return result.content;
    }

    throw API_CLIENT_ERROR.create({
      detail: "Cannot fetch published file without releaseId or environmentName",
      status: 400,
    });
  }
}
