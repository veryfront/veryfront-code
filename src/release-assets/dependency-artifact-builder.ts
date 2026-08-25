import { recordDependencyArtifactBuild } from "#veryfront/observability/metrics/index.ts";
import { buildEsmShUrl } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { looksLikeHtmlContent } from "#veryfront/transforms/esm/html-content.ts";
import { computeHashBytes, serverLogger } from "#veryfront/utils";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "./constants.ts";
import type {
  DependencyArtifactBuildResultBody,
  DependencyArtifactBuildTaskInput,
  DependencyArtifactContentType,
  DependencyArtifactIdentity,
  DependencyArtifactPolicyDecision,
} from "./dependency-artifact-contracts.ts";
import {
  type DependencyArtifactAsset,
  DependencyArtifactGraphError,
  type DependencyArtifactImportResolution,
  type DependencyArtifactSourceModule,
  materializeDependencyArtifactGraph,
  readDependencyArtifactModuleSpecifiers,
} from "./dependency-artifact-graph.ts";

export type {
  DependencyArtifactBuildResultBody,
  DependencyArtifactBuildTaskInput,
  DependencyArtifactContentType,
  DependencyArtifactIdentity,
  DependencyArtifactPolicyDecision,
} from "./dependency-artifact-contracts.ts";
export { DEPENDENCY_ARTIFACT_BUILD_CAPABILITY } from "./dependency-artifact-contracts.ts";

const logger = serverLogger.component("dependency-artifact-build");
const EXACT_SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SUBPATH = /^(?:[A-Za-z0-9._~+-]+)(?:\/[A-Za-z0-9._~+-]+)*$/;
const FAILURE_CODE = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_UPSTREAM_REDIRECTS = 5;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface DependencyArtifactBuildClient {
  uploadAsset(input: {
    artifactId: string;
    attemptCount: number;
    contentHash: string;
    contentType: DependencyArtifactContentType;
    bytes: Uint8Array<ArrayBuffer>;
  }): Promise<{ stored: true; existed: boolean }>;
  reportResult(input: {
    artifactId: string;
    attemptCount: number;
    result: DependencyArtifactBuildResultBody;
  }): Promise<{ accepted: true; state: "ready" | "failed" }>;
}

export interface DependencyArtifactBuildLimits {
  maxAssetBytes: number;
  maxTotalBytes: number;
  maxModules: number;
  maxDepth: number;
  timeoutMs: number;
}

export interface DependencyArtifactBuildMetric {
  event: "claim" | "success" | "failure";
  durationMs?: number;
  totalBytes?: number;
  assetCount?: number;
  remainingExternalImportCount?: number;
  failureCode?: string;
}

export interface DependencyArtifactBuilderDeps {
  fetch?: typeof fetch;
  limits?: Partial<DependencyArtifactBuildLimits>;
  now?: () => number;
  recordMetric?: (metric: DependencyArtifactBuildMetric) => void;
}

const DEFAULT_LIMITS: DependencyArtifactBuildLimits = {
  maxAssetBytes: RELEASE_ASSET_MAX_SIZE_BYTES,
  maxTotalBytes: 64 * 1024 * 1024,
  maxModules: 1024,
  maxDepth: 64,
  timeoutMs: 30_000,
};

export class DependencyArtifactBuildError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = "DependencyArtifactBuildError";
  }
}

export function parseDependencyArtifactBuildTaskInput(
  value: unknown,
): DependencyArtifactBuildTaskInput {
  if (
    !isRecord(value) || !hasOnlyKeys(value, ["artifact_id", "attempt_count", "identity", "policy"])
  ) {
    throw new DependencyArtifactBuildError(
      "invalid_task_input",
      "Invalid dependency artifact build input",
    );
  }

  const identity = parseIdentity(value.identity);
  const policy = parsePolicy(value.policy);
  if (
    typeof value.artifact_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.artifact_id,
    ) ||
    !Number.isSafeInteger(value.attempt_count) ||
    (value.attempt_count as number) <= 0
  ) {
    throw new DependencyArtifactBuildError(
      "invalid_task_input",
      "Invalid dependency artifact build input",
    );
  }

  return {
    artifact_id: value.artifact_id,
    attempt_count: value.attempt_count as number,
    identity,
    policy,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys<K extends string>(
  value: Record<string, unknown>,
  allowed: readonly K[],
): value is { [P in K]?: unknown } {
  const allowedKeys = new Set<string>(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function invalidTaskInput(): never {
  throw new DependencyArtifactBuildError(
    "invalid_task_input",
    "Invalid dependency artifact build input",
  );
}

function parseIdentity(value: unknown): DependencyArtifactIdentity {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "origin_key",
      "package_name",
      "exact_version",
      "subpath",
      "target",
      "profile",
    ]) ||
    value.origin_key !== "npm:public" ||
    typeof value.package_name !== "string" ||
    value.package_name.length > 214 ||
    !PACKAGE_NAME.test(value.package_name) ||
    typeof value.exact_version !== "string" ||
    value.exact_version.length > 128 ||
    !EXACT_SEMVER.test(value.exact_version) ||
    typeof value.subpath !== "string" ||
    value.subpath.length > 512 ||
    (value.subpath !== "" && !SUBPATH.test(value.subpath)) ||
    value.subpath.split("/").some((segment) => segment === "." || segment === "..") ||
    value.target !== "es2022" ||
    (value.profile !== "standard-v1" &&
      value.profile !== "react-v1" &&
      value.profile !== "react-dom-v1")
  ) {
    return invalidTaskInput();
  }

  const profileMatches = value.package_name === "react"
    ? value.profile === "react-v1"
    : value.package_name === "react-dom"
    ? value.profile === "react-dom-v1"
    : value.profile === "standard-v1";
  if (!profileMatches) return invalidTaskInput();

  return value as DependencyArtifactIdentity;
}

function parsePolicy(value: unknown): DependencyArtifactPolicyDecision {
  if (!isRecord(value) || typeof value.decision !== "string") return invalidTaskInput();
  if (value.decision === "allow") {
    if (!hasOnlyKeys(value, ["decision"])) return invalidTaskInput();
    return { decision: "allow" };
  }

  const expectedKeys = value.decision === "too_young"
    ? ["decision", "reason_code", "retry_after"]
    : ["decision", "reason_code"];
  if (
    (value.decision !== "deny" && value.decision !== "too_young") ||
    !hasOnlyKeys(value, expectedKeys) ||
    typeof value.reason_code !== "string" ||
    !FAILURE_CODE.test(value.reason_code)
  ) {
    return invalidTaskInput();
  }

  if (value.decision === "deny") {
    return { decision: "deny", reason_code: value.reason_code };
  }
  if (
    typeof value.retry_after !== "string" ||
    Number.isNaN(Date.parse(value.retry_after)) ||
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(value.retry_after)
  ) {
    return invalidTaskInput();
  }
  return {
    decision: "too_young",
    reason_code: value.reason_code,
    retry_after: value.retry_after,
  };
}

function profileExternals(identity: DependencyArtifactIdentity): string[] {
  if (identity.profile === "react-v1") return [];
  if (identity.profile === "react-dom-v1") return ["react"];
  return ["react", "react-dom"];
}

export function dependencyArtifactUpstreamUrl(identity: DependencyArtifactIdentity): string {
  const subpath = identity.subpath ? `/${identity.subpath}` : undefined;
  return buildEsmShUrl(identity.package_name, identity.exact_version, subpath, {
    external: profileExternals(identity),
    target: identity.target,
  });
}

function isExternalSpecifier(specifier: string, externals: readonly string[]): boolean {
  return externals.some((external) =>
    specifier === external || specifier.startsWith(`${external}/`)
  );
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith("/") &&
    !specifier.startsWith("./") &&
    !specifier.startsWith("../") &&
    !specifier.includes(":");
}

function resolveUpstreamImport(
  specifier: string,
  parentUrl: string,
  externals: readonly string[],
): DependencyArtifactImportResolution {
  if (isBareSpecifier(specifier)) {
    return isExternalSpecifier(specifier, externals)
      ? { kind: "external" }
      : { kind: "invalid", failureCode: "undeclared_external" };
  }

  let url: URL;
  try {
    url = new URL(specifier, parentUrl);
  } catch {
    return { kind: "invalid", failureCode: "unresolved_import" };
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "esm.sh" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return { kind: "invalid", failureCode: "upstream_host_denied" };
  }
  url.hash = "";
  return { kind: "module", moduleId: url.toString() };
}

function resolveAllowedUpstreamUrl(value: string, baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new DependencyArtifactBuildError(
      "upstream_redirect_invalid",
      "Dependency artifact upstream returned an invalid redirect",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "esm.sh" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new DependencyArtifactBuildError(
      "upstream_host_denied",
      "Dependency artifact upstream redirected to a denied host",
    );
  }
  url.hash = "";
  return url.toString();
}

function normalizeContentType(value: string | null): DependencyArtifactContentType | null {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    contentType === "text/javascript" ||
    contentType === "application/javascript" ||
    contentType === "text/ecmascript" ||
    contentType === "application/ecmascript"
  ) {
    return "text/javascript";
  }
  if (contentType === "text/css") return "text/css";
  return null;
}

function sanitizedFailureMessage(error: unknown): string {
  if (error instanceof DependencyArtifactBuildError) return error.message;
  if (error instanceof DependencyArtifactGraphError) return error.message;
  return "Dependency artifact build failed";
}

function defaultRecordMetric(metric: DependencyArtifactBuildMetric): void {
  logger.info("Dependency artifact build metric", {
    event: metric.event,
    duration_ms: metric.durationMs,
    total_bytes: metric.totalBytes,
    asset_count: metric.assetCount,
    remaining_external_import_count: metric.remainingExternalImportCount,
    failure_code: metric.failureCode,
  });
  recordDependencyArtifactBuild(metric);
}

function mergeLimits(
  overrides?: Partial<DependencyArtifactBuildLimits>,
): DependencyArtifactBuildLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (
    !Number.isSafeInteger(limits.maxAssetBytes) ||
    limits.maxAssetBytes <= 0 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes <= 0 ||
    !Number.isSafeInteger(limits.maxModules) ||
    limits.maxModules <= 0 ||
    !Number.isSafeInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isSafeInteger(limits.timeoutMs) ||
    limits.timeoutMs < 0 ||
    limits.timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new DependencyArtifactBuildError(
      "invalid_limits",
      "Dependency artifact build limits are invalid",
    );
  }
  return limits;
}

interface UpstreamDeadline {
  readonly signal: AbortSignal;
  race<T>(operation: () => Promise<T>, cleanup?: () => void): Promise<T>;
  dispose(): void;
}

function upstreamTimeoutError(): DependencyArtifactBuildError {
  return new DependencyArtifactBuildError(
    "upstream_timeout",
    "Dependency artifact upstream request timed out",
  );
}

function createUpstreamDeadline(timeoutMs: number): UpstreamDeadline {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new DependencyArtifactBuildError(
      "invalid_limits",
      `Dependency artifact timeout must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }

  const controller = new AbortController();
  const expiresAt = performance.now() + timeoutMs;
  const timeoutError = upstreamTimeoutError();
  let expired = false;
  let disposed = false;
  let activeOperation: { token: object; cleanup?: () => void } | undefined;
  let rejectDeadline!: (error: DependencyArtifactBuildError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });

  const expire = (): void => {
    if (expired || disposed) return;
    expired = true;
    rejectDeadline(timeoutError);
    controller.abort(timeoutError);
    try {
      activeOperation?.cleanup?.();
    } catch {
      // Cancellation is best-effort cleanup; the deadline rejection is authoritative.
    }
  };
  const timeout = setTimeout(expire, timeoutMs);

  return {
    signal: controller.signal,
    async race<T>(operation: () => Promise<T>, cleanup?: () => void): Promise<T> {
      if (expired || performance.now() >= expiresAt) {
        expire();
        return await deadline;
      }

      const token = {};
      activeOperation = { token, cleanup };
      try {
        return await Promise.race([operation(), deadline]);
      } finally {
        if (activeOperation?.token === token) activeOperation = undefined;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeOperation = undefined;
      clearTimeout(timeout);
    },
  };
}

function cancelResponseBody(response: Response, reason?: unknown): void {
  void response.body?.cancel(reason).catch(() => undefined);
}

async function fetchSourceModules(
  identity: DependencyArtifactIdentity,
  fetcher: typeof fetch,
  limits: DependencyArtifactBuildLimits,
): Promise<{
  modules: Map<string, DependencyArtifactSourceModule>;
  rootId: string;
}> {
  const rootId = dependencyArtifactUpstreamUrl(identity);
  const externals = profileExternals(identity);
  const modules = new Map<string, DependencyArtifactSourceModule>();
  let totalBytes = 0;
  const deadline = createUpstreamDeadline(limits.timeoutMs);

  async function fetchAllowedModule(moduleId: string): Promise<{
    response: Response;
    finalUrl: string;
  }> {
    let currentUrl = resolveAllowedUpstreamUrl(moduleId, moduleId);
    for (let redirectCount = 0; redirectCount <= MAX_UPSTREAM_REDIRECTS; redirectCount++) {
      let response: Response;
      try {
        response = await deadline.race(() =>
          fetcher(currentUrl, {
            headers: {
              accept: "text/javascript, application/javascript, text/css;q=0.9",
              "user-agent": "Mozilla/5.0 Veryfront/1.0",
            },
            redirect: "manual",
            signal: deadline.signal,
          })
        );
      } catch (error) {
        if (
          deadline.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw upstreamTimeoutError();
        }
        throw new DependencyArtifactBuildError(
          "upstream_fetch_failed",
          "Dependency artifact upstream request failed",
        );
      }

      if (response.status < 300 || response.status >= 400) {
        return { response, finalUrl: currentUrl };
      }

      const location = response.headers.get("location");
      cancelResponseBody(response);
      if (!location) {
        throw new DependencyArtifactBuildError(
          "upstream_redirect_invalid",
          "Dependency artifact upstream returned an invalid redirect",
        );
      }
      if (redirectCount === MAX_UPSTREAM_REDIRECTS) {
        throw new DependencyArtifactBuildError(
          "upstream_redirect_limit",
          "Dependency artifact upstream exceeded the redirect limit",
        );
      }
      currentUrl = resolveAllowedUpstreamUrl(location, currentUrl);
    }

    throw new DependencyArtifactBuildError(
      "upstream_redirect_limit",
      "Dependency artifact upstream exceeded the redirect limit",
    );
  }

  async function visit(moduleId: string, depth: number): Promise<void> {
    if (modules.has(moduleId)) return;
    if (depth > limits.maxDepth) {
      throw new DependencyArtifactBuildError(
        "graph_depth_limit",
        "Dependency artifact graph exceeds the depth limit",
      );
    }
    if (modules.size >= limits.maxModules) {
      throw new DependencyArtifactBuildError(
        "graph_module_limit",
        "Dependency artifact graph exceeds the module limit",
      );
    }

    const { response, finalUrl } = await fetchAllowedModule(moduleId);

    if (!response.ok) {
      cancelResponseBody(response);
      throw new DependencyArtifactBuildError(
        "upstream_http_error",
        "Dependency artifact upstream returned an unsuccessful response",
      );
    }
    const rawContentType = response.headers.get("content-type");
    if (rawContentType?.toLowerCase().includes("text/html")) {
      cancelResponseBody(response);
      throw new DependencyArtifactBuildError(
        "upstream_html",
        "Dependency artifact upstream returned HTML",
      );
    }
    const contentType = normalizeContentType(rawContentType);
    if (!contentType) {
      cancelResponseBody(response);
      throw new DependencyArtifactBuildError(
        "upstream_content_type",
        "Dependency artifact upstream returned an unsupported content type",
      );
    }

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBoundedResponseBytes(response, totalBytes, limits, deadline);
    } catch (error) {
      if (
        error instanceof DependencyArtifactBuildError ||
        error instanceof DependencyArtifactGraphError
      ) {
        throw error;
      }
      if (
        deadline.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw upstreamTimeoutError();
      }
      throw new DependencyArtifactBuildError(
        "upstream_fetch_failed",
        "Dependency artifact upstream request failed",
      );
    }
    totalBytes += bytes.byteLength;

    const code = new TextDecoder().decode(bytes);
    if (looksLikeHtmlContent(code)) {
      throw new DependencyArtifactBuildError(
        "upstream_html",
        "Dependency artifact upstream returned HTML",
      );
    }

    const module: DependencyArtifactSourceModule = {
      id: moduleId,
      code,
      contentType,
      resolutionBaseId: finalUrl,
    };
    modules.set(moduleId, module);
    for (const specifier of await readDependencyArtifactModuleSpecifiers(module)) {
      const resolution = resolveUpstreamImport(specifier, finalUrl, externals);
      if (resolution.kind === "external") continue;
      if (resolution.kind === "invalid") {
        throw new DependencyArtifactBuildError(
          resolution.failureCode,
          "Dependency artifact contains an import outside its allowed closure",
        );
      }
      await visit(resolution.moduleId, depth + 1);
    }
  }

  try {
    await visit(rootId, 0);
    return { modules, rootId };
  } finally {
    deadline.dispose();
  }
}

async function readBoundedResponseBytes(
  response: Response,
  currentTotalBytes: number,
  limits: DependencyArtifactBuildLimits,
  deadline: UpstreamDeadline,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLengthHeader = response.headers.get("content-length");
  if (declaredLengthHeader !== null) {
    const declaredLength = Number(declaredLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength >= 0) {
      if (declaredLength > limits.maxAssetBytes) {
        cancelResponseBody(response);
        throw new DependencyArtifactBuildError(
          "asset_size_limit",
          "Dependency artifact asset exceeds the size limit",
        );
      }
      if (currentTotalBytes + declaredLength > limits.maxTotalBytes) {
        cancelResponseBody(response);
        throw new DependencyArtifactBuildError(
          "graph_total_size_limit",
          "Dependency artifact graph exceeds the total size limit",
        );
      }
    }
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await deadline.race(
        () => reader.read(),
        () => void reader.cancel(upstreamTimeoutError()).catch(() => undefined),
      );
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxAssetBytes) {
        void reader.cancel().catch(() => undefined);
        throw new DependencyArtifactBuildError(
          "asset_size_limit",
          "Dependency artifact asset exceeds the size limit",
        );
      }
      if (currentTotalBytes + size > limits.maxTotalBytes) {
        void reader.cancel().catch(() => undefined);
        throw new DependencyArtifactBuildError(
          "graph_total_size_limit",
          "Dependency artifact graph exceeds the total size limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function buildDependencyArtifactGraph(
  identity: DependencyArtifactIdentity,
  deps: DependencyArtifactBuilderDeps = {},
): Promise<{
  assets: DependencyArtifactAsset[];
  rootContentHash: string;
  remainingExternalImportCount: number;
}> {
  const limits = mergeLimits(deps.limits);
  const { modules, rootId } = await fetchSourceModules(
    identity,
    deps.fetch ?? fetch,
    limits,
  );
  const externals = profileExternals(identity);
  return await materializeDependencyArtifactGraph({
    modules,
    rootId,
    maxAssetBytes: limits.maxAssetBytes,
    resolveImport: (specifier, parent) =>
      resolveUpstreamImport(specifier, parent.resolutionBaseId ?? parent.id, externals),
  });
}

function failureCode(error: unknown): string {
  if (error instanceof DependencyArtifactBuildError) return error.failureCode;
  if (error instanceof DependencyArtifactGraphError) return error.failureCode;
  return "build_failed";
}

function uniqueAssets(assets: readonly DependencyArtifactAsset[]): DependencyArtifactAsset[] {
  return [...new Map(assets.map((asset) => [asset.contentHash, asset])).values()];
}

async function reportFailedResult(
  client: DependencyArtifactBuildClient,
  input: DependencyArtifactBuildTaskInput,
  result: Extract<DependencyArtifactBuildResultBody, { outcome: "failed" }>,
): Promise<void> {
  try {
    await client.reportResult({
      artifactId: input.artifact_id,
      attemptCount: input.attempt_count,
      result,
    });
  } catch (reportingError) {
    logger.warn("Dependency artifact failure result could not be reported", {
      failure_code: result.failure_code,
      error: reportingError,
    });
  }
}

export async function runDependencyArtifactBuild(
  input: DependencyArtifactBuildTaskInput,
  client: DependencyArtifactBuildClient,
  deps: DependencyArtifactBuilderDeps = {},
): Promise<
  | {
    success: true;
    state: "ready";
    rootContentHash: string;
    assetCount: number;
    totalBytes: number;
    remainingExternalImportCount: number;
    durationMs: number;
  }
  | {
    success: false;
    state: "failed";
    failureCode: string;
    durationMs: number;
  }
> {
  const now = deps.now ?? Date.now;
  const recordMetric = deps.recordMetric ?? defaultRecordMetric;
  const startedAt = now();
  recordMetric({ event: "claim" });

  try {
    if (input.policy.decision !== "allow") {
      const failedResult: DependencyArtifactBuildResultBody = {
        outcome: "failed",
        failure_code: input.policy.reason_code,
        failure_message: input.policy.decision === "too_young"
          ? "Dependency artifact package age policy denied the build"
          : "Dependency artifact policy denied the build",
        ...(input.policy.decision === "too_young" ? { retry_after: input.policy.retry_after } : {}),
      };
      await reportFailedResult(client, input, failedResult);
      const durationMs = Math.max(0, now() - startedAt);
      recordMetric({
        event: "failure",
        durationMs,
        failureCode: input.policy.reason_code,
        assetCount: 0,
        totalBytes: 0,
        remainingExternalImportCount: 0,
      });
      return {
        success: false,
        state: "failed",
        failureCode: input.policy.reason_code,
        durationMs,
      };
    }

    const built = await buildDependencyArtifactGraph(input.identity, deps);
    const assets = uniqueAssets(built.assets);
    for (const asset of assets) {
      if (await computeHashBytes(asset.bytes) !== asset.contentHash) {
        throw new DependencyArtifactBuildError(
          "hash_mismatch",
          "Dependency artifact hash verification failed",
        );
      }
      await client.uploadAsset({
        artifactId: input.artifact_id,
        attemptCount: input.attempt_count,
        contentHash: asset.contentHash,
        contentType: asset.contentType,
        bytes: asset.bytes,
      });
    }

    const publication: DependencyArtifactBuildResultBody = {
      outcome: "ready",
      graph: {
        graph_schema_version: 1,
        root_content_hash: built.rootContentHash,
        assets: assets.map((asset) => ({
          content_hash: asset.contentHash,
          content_type: asset.contentType,
          size: asset.size,
        })),
      },
    };
    const published = await client.reportResult({
      artifactId: input.artifact_id,
      attemptCount: input.attempt_count,
      result: publication,
    });
    if (published.state !== "ready") {
      throw new DependencyArtifactBuildError(
        "result_state_mismatch",
        "Dependency artifact result was not published ready",
      );
    }

    const durationMs = Math.max(0, now() - startedAt);
    const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
    recordMetric({
      event: "success",
      durationMs,
      totalBytes,
      assetCount: assets.length,
      remainingExternalImportCount: built.remainingExternalImportCount,
    });
    return {
      success: true,
      state: "ready",
      rootContentHash: built.rootContentHash,
      assetCount: assets.length,
      totalBytes,
      remainingExternalImportCount: built.remainingExternalImportCount,
      durationMs,
    };
  } catch (error) {
    const code = failureCode(error);
    const result: DependencyArtifactBuildResultBody = {
      outcome: "failed",
      failure_code: code,
      failure_message: sanitizedFailureMessage(error),
    };
    await reportFailedResult(client, input, result);
    const durationMs = Math.max(0, now() - startedAt);
    recordMetric({
      event: "failure",
      durationMs,
      failureCode: code,
      totalBytes: 0,
      assetCount: 0,
      remainingExternalImportCount: 0,
    });
    return { success: false, state: "failed", failureCode: code, durationMs };
  }
}
