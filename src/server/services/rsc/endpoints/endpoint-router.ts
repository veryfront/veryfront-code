/**
 * RSC endpoint router and orchestrator
 * @module rsc-endpoints/endpoint-router
 */

import { HTTP_SERVER_ERROR, isRSCEnabled, serverLogger } from "#veryfront/utils";
import { metrics } from "#veryfront/observability";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  type BrowserModuleBundle,
  BrowserModuleDependencySnapshotError,
  BrowserModuleEntryRejectedError,
  bundleBrowserModuleWithMetadata,
  validateBrowserModuleBundle,
} from "#veryfront/server/shared/browser-module-bundler.ts";
import {
  BrowserModuleBuildCoordinator,
  type BrowserModuleBuildCoordinatorOptions,
  BrowserModuleCapacityError,
} from "#veryfront/server/shared/browser-module-availability.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSourceInput,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isDependencyPinningEnabled } from "#veryfront/transforms/esm/npm-registry-client.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import type { RSCDevServerHandler } from "../orchestrators/index.ts";
import { handleActionRequest } from "./action-handler.ts";
import { getRSCHandler } from "./handler-registry.ts";
import { handleClientScript, handleDomScript } from "./script-handlers.ts";
import type { RSCEndpointParams } from "./types.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import { classifyBrowserModuleAbsoluteSourcePath } from "#veryfront/modules/server/browser-module-admission.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";

const rscEndpointRouterLog = serverLogger.component("rsc-endpoint-router");
const rscLog = serverLogger.component("rsc");
const MODULE_CACHE_CONTROL = "private, no-cache, must-revalidate";
let browserModuleBuilds = new BrowserModuleBuildCoordinator<BrowserModuleBundle>();
let browserModuleBuilder = bundleBrowserModuleWithMetadata;
let browserModuleAdapterIds = new WeakMap<RuntimeAdapter, number>();
let nextBrowserModuleAdapterId = 1;

function hasProtectedBrowserModuleDependency(
  bundle: BrowserModuleBundle,
  projectDir: string,
  config?: VeryfrontConfig,
): boolean {
  return bundle.dependencies.some((dependency) =>
    classifyBrowserModuleAbsoluteSourcePath(
      dependency.path,
      projectDir,
      { config, rscEnabled: true },
    ).protectionReason !== null
  );
}

export function resetBrowserModuleEndpointStateForTesting(
  options: BrowserModuleBuildCoordinatorOptions = {},
): void {
  browserModuleBuilds.resetForTesting();
  browserModuleBuilds = new BrowserModuleBuildCoordinator<BrowserModuleBundle>(options);
  browserModuleBuilder = bundleBrowserModuleWithMetadata;
  browserModuleAdapterIds = new WeakMap<RuntimeAdapter, number>();
  nextBrowserModuleAdapterId = 1;
}

/** Override the browser module builder for focused endpoint tests. */
export function setBrowserModuleBuilderForTesting(
  builder?: typeof bundleBrowserModuleWithMetadata,
): void {
  browserModuleBuilder = builder ?? bundleBrowserModuleWithMetadata;
}

export function getBrowserModuleEndpointStatsForTesting() {
  return browserModuleBuilds.getStatsForTesting();
}

/**
 * Handle RSC endpoints
 * @param params - RSC endpoint parameters
 * @returns Response or null if not an RSC endpoint
 */
export async function handleRSCEndpoint(
  {
    req,
    pathname,
    projectDir,
    projectId,
    projectSlug,
    contentSourceId,
    releaseId,
    branch,
    dependencyPinningSource: providedDependencyPinningSource,
    adapter,
    config,
    isLocalProject,
    allowHostProjectCodeExecution,
    mode,
    nonce,
    applicationIdentityHeaderNames,
    applicationIdentity,
  }: RSCEndpointParams,
): Promise<Response | null> {
  if (!pathname.startsWith("/_veryfront/rsc/")) {
    return null;
  }

  const sub = pathname.replace("/_veryfront/rsc/", "");

  // Always serve client.js and dom.js regardless of RSC being enabled
  // These are needed for basic hydration even without full RSC
  if (sub === "client.js") {
    return handleClientScript(adapter);
  }
  if (sub === "dom.js") {
    return handleDomScript(adapter);
  }

  // Always return 410 Gone for deprecated flight_page endpoint
  // regardless of RSC being enabled.
  // NOTE: NOT dead. This branch is actively asserted by endpoint-router.test.ts
  // and several integration tests (tests/integration/server/rsc/*, flight-smoke)
  // that verify clients hitting /_veryfront/rsc/flight_page receive 410 Gone.
  // Do not remove until those clients/tests stop exercising the endpoint.
  if (sub === "flight_page") {
    return new Response("Flight endpoint removed. Use custom RSC endpoints.", { status: 410 });
  }

  // These transports import or evaluate project-owned server modules. Until
  // the generation-owned isolated RSC graph is connected to the worker
  // renderer, requests without an explicit host capability must not fall back
  // to the host realm.
  if (!allowHostProjectCodeExecution && isRscServerExecutionEndpoint(sub)) {
    const unavailable = createErrorResponseFromDefinition(
      PROJECT_EXECUTION_UNAVAILABLE,
      {
        detail: "RSC server execution requires a dedicated isolated project runtime",
        instance: pathname,
      },
    );
    unavailable.headers.set("cache-control", "no-store");
    unavailable.headers.set("retry-after", "1");
    return req.method === "HEAD"
      ? new Response(null, {
        status: unavailable.status,
        statusText: unavailable.statusText,
        headers: unavailable.headers,
      })
      : unavailable;
  }

  const url = new URL(req.url);
  const dependencyPinningSource = providedDependencyPinningSource ??
    createDependencyPinningSource({
      projectDir,
      adapter,
      isLocalProject,
      projectId,
      projectSlug,
      contentSourceId,
      releaseId,
      branch,
      config,
    });

  try {
    // App-router client-page hydration imports browser-safe page modules from
    // this endpoint even when the broader RSC transport is not enabled.
    if (sub === "module") {
      return await handleModuleEndpoint({
        req,
        searchParams: url.searchParams,
        projectDir,
        projectId,
        projectSlug,
        contentSourceId,
        releaseId,
        branch,
        dependencyPinningSource,
        adapter,
        config,
      });
    }

    if (!isRSCEnabled(config)) {
      return null;
    }

    const snapshotBoundEndpoint = isDependencySnapshotBoundEndpoint(sub);
    if (snapshotBoundEndpoint) {
      const dependencySnapshotError = await validateRequestedDependencySnapshot(
        dependencyPinningSource,
        req,
      );
      if (dependencySnapshotError) return dependencySnapshotError;
    }
    const validatedDependencyPinningCacheKey = snapshotBoundEndpoint
      ? req.headers.get(RSC_DEPENDENCY_PINNING_HEADER) ?? undefined
      : undefined;

    const handler = getRSCHandler(projectDir, projectId, {
      adapter,
      config,
      contentSourceId,
      isLocalProject,
      mode,
      projectId,
      projectSlug,
      releaseId,
      branch,
      dependencyPinningEnabled: isDependencyPinningEnabled(),
      dependencyPinningCacheKey: validatedDependencyPinningCacheKey,
      dependencyPinningSource,
    });

    if (sub.startsWith("render/")) {
      return handler.handleRender(sub.replace("render/", ""), url.searchParams, req);
    }
    if (sub === "render") {
      return handler.handleRender("/", url.searchParams, req);
    }
    if (sub.startsWith("page/")) {
      metrics.recordRSC("page");
      return handler.handlePage(sub.replace("page/", ""), url.searchParams, nonce);
    }
    if (sub.startsWith("stream/")) {
      metrics.recordRSC("stream");
      return handler.handleStream(sub.replace("stream/", ""), url.searchParams, req);
    }

    if (sub === "probe") {
      return new Response(JSON.stringify({ ok: true, rsc: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (sub === "action") {
      if (req.method !== "POST") {
        return withDependencyPinningVary(
          new Response("Method Not Allowed", {
            status: HttpStatus.METHOD_NOT_ALLOWED,
          }),
        );
      }

      metrics.recordRSC("action");
      try {
        return await handleActionRequest({
          req,
          projectDir,
          projectId,
          projectSlug,
          contentSourceId,
          releaseId,
          branch,
          isLocalProject,
          dependencyPinningSource,
          adapter,
          config,
          mode,
          applicationIdentityHeaderNames,
          applicationIdentity,
        });
      } catch (e) {
        metrics.recordRSC("error");
        rscEndpointRouterLog.error("action request failed", {
          errorName: e instanceof Error ? e.name : "UnknownError",
        });
        return withDependencyPinningVary(
          jsonErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "action failed",
          ),
        );
      }
    }

    if (sub === "manifest") {
      metrics.recordRSC("manifest");
      return handler.handleManifest(
        req.headers.get(RSC_DEPENDENCY_PINNING_HEADER) ?? undefined,
      );
    }

    if (sub === "payload") {
      metrics.recordRSC("page");
      return handlePayloadEndpoint({ handler, searchParams: url.searchParams, request: req });
    }

    if (sub === "page") {
      metrics.recordRSC("page");
      return handler.handlePage("/", url.searchParams, nonce);
    }

    if (sub === "stream") {
      metrics.recordRSC("stream");
      return handleStreamEndpoint(url.searchParams, req);
    }

    return null;
  } catch (e) {
    if (e instanceof Error && e.message === "Component not found") {
      serverLogger.debug(
        "[RSCEndpointRouter] component not found, deferring to legacy handler",
        { error: e.message },
      );
      return null;
    }

    try {
      metrics.recordRSC("error");
    } catch (metricsError) {
      rscEndpointRouterLog.debug("Failed to record metrics", metricsError);
    }

    rscLog.debug("[dev] endpoint failed", {
      errorName: e instanceof Error ? e.name : "UnknownError",
    });
    return new Response("Internal Error", {
      status: HTTP_SERVER_ERROR,
      headers: {
        "cache-control": "no-store",
        ...(isDependencySnapshotBoundEndpoint(sub) ? { vary: RSC_DEPENDENCY_PINNING_HEADER } : {}),
      },
    });
  }
}

function isRscServerExecutionEndpoint(sub: string): boolean {
  return sub === "action" ||
    sub === "payload" ||
    sub === "render" ||
    sub.startsWith("render/") ||
    sub === "stream" ||
    sub.startsWith("stream/");
}

function isDependencySnapshotBoundEndpoint(sub: string): boolean {
  return sub === "render" ||
    sub.startsWith("render/") ||
    sub === "manifest" ||
    sub === "payload" ||
    sub === "stream" ||
    sub.startsWith("stream/");
}

async function validateRequestedDependencySnapshot(
  dependencyPinningSource: DependencyPinningSourceInput,
  request: Request,
): Promise<Response | null> {
  const requestedPinKey = request.headers.get(RSC_DEPENDENCY_PINNING_HEADER);
  if (requestedPinKey !== null && !requestedPinKey.startsWith("on:")) {
    return unknownDependencySnapshotResponse();
  }

  const snapshot = await resolveRequestedDependencyPinningSnapshot(
    dependencyPinningSource,
    requestedPinKey,
  );
  if (
    !snapshot ||
    (requestedPinKey === null && snapshot.cacheKey !== "off")
  ) {
    return unknownDependencySnapshotResponse();
  }
  return null;
}

function unknownDependencySnapshotResponse(): Response {
  return new Response("Unknown dependency snapshot", {
    status: HttpStatus.CONFLICT,
    headers: {
      "cache-control": "no-store",
      vary: RSC_DEPENDENCY_PINNING_HEADER,
    },
  });
}

async function handleModuleEndpoint({
  req,
  searchParams,
  projectDir,
  projectId,
  projectSlug,
  contentSourceId,
  releaseId,
  branch,
  dependencyPinningSource,
  adapter,
  config,
}: {
  req: Request;
  searchParams: URLSearchParams;
  projectDir: string;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  releaseId?: string;
  branch?: string | null;
  dependencyPinningSource: DependencyPinningSourceInput;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
}): Promise<Response> {
  const relParam = searchParams.get("rel");
  if (!relParam) {
    return new Response("Missing rel query parameter", {
      status: HttpStatus.BAD_REQUEST,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  }

  const normalizedRel = relParam.replace(/\\+/g, "/");
  const relSegments = normalizedRel.split("/").filter(Boolean);
  if (relSegments.includes("..")) {
    return new Response("Invalid rel query parameter", {
      status: HttpStatus.BAD_REQUEST,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  }

  const rel = normalizedRel.startsWith("/") ? normalizedRel : `/${normalizedRel}`;
  const requestedPinKeys = searchParams.getAll("pins");
  const hasMalformedPinKey = requestedPinKeys.length > 1 ||
    (requestedPinKeys.length === 1 &&
      !isCanonicalDependencyPinningCacheKey(requestedPinKeys[0] ?? ""));
  const requestedPinKey = requestedPinKeys[0];
  if (hasMalformedPinKey || (requestedPinKeys.length === 0 && isDependencyPinningEnabled())) {
    return new Response("Unknown dependency snapshot", {
      status: HttpStatus.CONFLICT,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const moduleServerOrigin = new URL(req.url).origin;
    const modulePath = resolveModuleEndpointPath(rel, projectDir, config);
    if (!modulePath) {
      return new Response("Not Found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    const entryPolicy = classifyBrowserModuleAbsoluteSourcePath(
      modulePath,
      projectDir,
      { config, rscEnabled: true },
    );
    if (entryPolicy.protectionReason) {
      return new Response("Not Found", {
        status: HttpStatus.NOT_FOUND,
        headers: { "cache-control": "no-store" },
      });
    }

    const adapterId = getBrowserModuleAdapterId(adapter);
    const configHash = await computeHash(stableSerialize(config ?? null));
    const dependencyPinningCacheKey = requestedPinKey ?? "off";
    const projectKey = projectId ?? projectSlug ?? projectDir;
    const cacheKey = buildBrowserModuleCacheKey({
      adapterId,
      projectKey,
      contentSourceId,
      releaseId,
      branch,
      configHash,
      moduleServerOrigin,
      dependencyPinningCacheKey,
      modulePath,
    });
    const result = await browserModuleBuilds.getOrBuild({
      cacheKey,
      projectKey,
      build: async () => {
        const bundle = await browserModuleBuilder(modulePath, {
          adapter,
          projectDir,
          projectId: projectId ?? projectSlug,
          config,
          projectSlug,
          moduleServerOrigin,
          ...(requestedPinKey
            ? { requestedDependencyPinningCacheKey: requestedPinKey }
            : { dependencyPinningCacheKey }),
          dependencyPinningSource,
          signal: req.signal,
          requireClientBoundary: true,
        });
        if (hasProtectedBrowserModuleDependency(bundle, projectDir, config)) {
          throw new BrowserModuleEntryRejectedError();
        }
        if (bundle.dependencyPinningCacheKey !== dependencyPinningCacheKey) {
          throw new BrowserModuleDependencySnapshotError();
        }
        return bundle;
      },
      validate: async (bundle) => {
        if (hasProtectedBrowserModuleDependency(bundle, projectDir, config)) return false;
        if (
          bundle.dependencyPinningCacheKey !== dependencyPinningCacheKey ||
          (dependencyPinningCacheKey.startsWith("on:") &&
            bundle.dependencyPinningDependencies === undefined)
        ) {
          return false;
        }
        return validateBrowserModuleBundle(bundle, {
          adapter,
          projectDir,
          signal: req.signal,
          importMap: {
            config,
            moduleServerOrigin,
            dependencyPinningCacheKey: bundle.dependencyPinningCacheKey,
            dependencyPinningDependencies: bundle.dependencyPinningDependencies,
            dependencyPinningSource,
          },
        });
      },
      sizeOf: estimateBrowserModuleBundleSize,
    });
    const etag = `"${result.value.contentHash}"`;
    const headers = {
      "cache-control": MODULE_CACHE_CONTROL,
      "etag": etag,
      "x-content-type-options": "nosniff",
    };
    if (ifNoneMatch(req.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: HttpStatus.NOT_MODIFIED, headers });
    }

    return new Response(result.value.source, {
      status: 200,
      headers: {
        ...headers,
        "content-type": "application/javascript; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof BrowserModuleDependencySnapshotError) {
      return new Response("Unknown dependency snapshot", {
        status: HttpStatus.CONFLICT,
        headers: { "cache-control": "no-store" },
      });
    }
    if (error instanceof BrowserModuleEntryRejectedError) {
      return new Response("Not Found", {
        status: HttpStatus.NOT_FOUND,
        headers: { "cache-control": "no-store" },
      });
    }
    if (error instanceof BrowserModuleCapacityError) {
      rscEndpointRouterLog.debug("module build capacity exhausted", {
        errorName: error.name,
      });
      return new Response("Service Unavailable", {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        headers: {
          "cache-control": "no-store",
          "retry-after": "1",
        },
      });
    }

    rscEndpointRouterLog.debug("module build failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return new Response("Internal Error", {
      status: HTTP_SERVER_ERROR,
      headers: { "cache-control": "no-store" },
    });
  }
}

interface BrowserModuleCacheKeyOptions {
  adapterId: number;
  projectKey: string;
  contentSourceId?: string;
  releaseId?: string;
  branch?: string | null;
  configHash: string;
  moduleServerOrigin?: string;
  dependencyPinningCacheKey?: string;
  modulePath: string;
}

export function buildBrowserModuleCacheKey(
  options: BrowserModuleCacheKeyOptions,
): string {
  const legacyFields = [
    options.adapterId,
    options.projectKey,
    options.contentSourceId ?? "",
    options.releaseId ?? "",
    options.configHash,
    options.modulePath,
  ];
  if (!options.dependencyPinningCacheKey?.startsWith("on:")) {
    return legacyFields.join("\0");
  }

  return [
    options.adapterId,
    options.projectKey,
    options.contentSourceId ?? "",
    options.releaseId ?? "",
    options.branch ?? "",
    options.configHash,
    options.moduleServerOrigin ?? "",
    options.dependencyPinningCacheKey,
    options.modulePath,
  ].join("\0");
}

function getBrowserModuleAdapterId(adapter: RuntimeAdapter): number {
  const existing = browserModuleAdapterIds.get(adapter);
  if (existing !== undefined) return existing;
  const id = nextBrowserModuleAdapterId++;
  browserModuleAdapterIds.set(adapter, id);
  return id;
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry, seen)}`);
  return `{${entries.join(",")}}`;
}

function estimateBrowserModuleBundleSize(bundle: BrowserModuleBundle): number {
  let size = new TextEncoder().encode(bundle.source).byteLength +
    bundle.contentHash.length + bundle.importMapHash.length +
    (bundle.dependencyPinningCacheKey?.length ?? 0);
  for (const [name, declaration] of Object.entries(bundle.dependencyPinningDependencies ?? {})) {
    size += name.length + declaration.length;
  }
  for (const dependency of bundle.dependencies) {
    size += dependency.path.length + dependency.contentHash.length + 8;
  }
  for (const probe of bundle.resolutionProbes) {
    size += probe.path.length + probe.state.length;
  }
  return size;
}

function ifNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

function resolveModuleEndpointPath(
  rel: string,
  projectDir: string,
  config?: VeryfrontConfig,
): string | null {
  const normalizedRel = rel.replace(/^\/+/, "");
  if (!/\.(?:[jt]sx?|[cm][jt]s)$/i.test(normalizedRel)) return null;

  const rootRelative = normalizePath(config?.directories?.app ?? "app").replace(/^\/+/, "");
  const root = normalizePath(joinPath(projectDir, rootRelative));
  if (!rootRelative || !isWithinDirectory(projectDir, root)) return null;

  const pathRelativeToRoot = normalizedRel.startsWith(`${rootRelative}/`)
    ? normalizedRel.slice(rootRelative.length + 1)
    : normalizedRel;
  const modulePath = normalizePath(joinPath(root, pathRelativeToRoot));
  if (!isWithinDirectory(root, modulePath)) return null;

  return modulePath;
}

/** Extract name parameter with fallback to "World" */
function getNameParam(searchParams: URLSearchParams): string {
  return searchParams.get("name")?.trim() || "World";
}

async function handlePayloadEndpoint({
  handler,
  searchParams,
  request,
}: {
  handler: RSCDevServerHandler;
  searchParams: URLSearchParams;
  request: Request;
}): Promise<Response> {
  return handler.handleRender("/", searchParams, request);
}

function handleStreamEndpoint(searchParams: URLSearchParams, request: Request): Response {
  const escapedName = escapeHtml(getNameParam(searchParams));
  const includeBadLine = searchParams.has("bad");

  const lines = [
    JSON.stringify({ type: "slot", id: "root", html: `<div>Loading ${escapedName}…</div>` }),
    JSON.stringify({
      type: "slot",
      id: "sidebar",
      html: `<aside data-state="loading">Sidebar loading…</aside>`,
    }),
    ...(includeBadLine ? ["{malformed json}"] : []),
    JSON.stringify({ type: "slot", id: "root", html: `<div>Hello ${escapedName}</div>` }),
    JSON.stringify({
      type: "slot",
      id: "sidebar",
      html: `<aside><ul><li>${escapedName} ready</li></ul></aside>`,
    }),
  ];

  return new Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
      vary: RSC_DEPENDENCY_PINNING_HEADER,
      ...(request.headers.get(RSC_DEPENDENCY_PINNING_HEADER)?.startsWith("on:")
        ? {
          [RSC_DEPENDENCY_PINNING_HEADER]: request.headers.get(RSC_DEPENDENCY_PINNING_HEADER)!,
        }
        : {}),
    },
  });
}

function withDependencyPinningVary(response: Response): Response {
  appendVaryHeader(response.headers, RSC_DEPENDENCY_PINNING_HEADER);
  response.headers.set("cache-control", "no-store");
  return response;
}

function appendVaryHeader(headers: Headers, fieldName: string): void {
  const values = (headers.get("vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.includes("*")) return;
  if (!values.some((value) => value.toLowerCase() === fieldName.toLowerCase())) {
    values.push(fieldName);
  }
  headers.set("vary", values.join(", "));
}
