/**
 * RSC endpoint router and orchestrator
 * @module rsc-endpoints/endpoint-router
 */

import { HTTP_SERVER_ERROR, isRSCEnabled, serverLogger } from "#veryfront/utils";
import { metrics } from "#veryfront/observability";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { buildImportMapJson } from "#veryfront/html";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  type BrowserModuleBundle,
  bundleBrowserModuleWithMetadata,
  validateBrowserModuleBundle,
} from "#veryfront/server/shared/browser-module-bundler.ts";
import {
  BrowserModuleBuildCoordinator,
  type BrowserModuleBuildCoordinatorOptions,
  BrowserModuleCapacityError,
} from "#veryfront/server/shared/browser-module-availability.ts";
import type { RSCDevServerHandler } from "../orchestrators/index.ts";
import { handleActionRequest } from "./action-handler.ts";
import { getRSCHandler } from "./handler-registry.ts";
import { handleClientScript, handleDomScript } from "./script-handlers.ts";
import type { RSCEndpointParams } from "./types.ts";
import { analyzeComponent } from "#veryfront/rendering/rsc/component-analyzer.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const rscEndpointRouterLog = serverLogger.component("rsc-endpoint-router");
const rscLog = serverLogger.component("rsc");
const MODULE_CACHE_CONTROL = "private, no-cache, must-revalidate";
let browserModuleBuilds = new BrowserModuleBuildCoordinator<BrowserModuleBundle>();
let browserModuleAdapterIds = new WeakMap<RuntimeAdapter, number>();
let nextBrowserModuleAdapterId = 1;

export function resetBrowserModuleEndpointStateForTesting(
  options: BrowserModuleBuildCoordinatorOptions = {},
): void {
  browserModuleBuilds.resetForTesting();
  browserModuleBuilds = new BrowserModuleBuildCoordinator<BrowserModuleBundle>(options);
  browserModuleAdapterIds = new WeakMap<RuntimeAdapter, number>();
  nextBrowserModuleAdapterId = 1;
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
    adapter,
    config,
    isLocalProject,
    mode,
    nonce,
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

  const url = new URL(req.url);

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
        adapter,
        config,
      });
    }

    if (!isRSCEnabled(config)) {
      return null;
    }

    const handler = getRSCHandler(projectDir, projectId, {
      adapter,
      config,
      contentSourceId,
      isLocalProject,
      mode,
      projectId,
      projectSlug,
      releaseId,
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
      return handler.handleStream(sub.replace("stream/", ""), url.searchParams);
    }

    if (sub === "probe") {
      return new Response(JSON.stringify({ ok: true, rsc: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (sub === "action") {
      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      metrics.recordRSC("action");
      try {
        return await handleActionRequest({
          req,
          projectDir,
          projectId,
          contentSourceId,
          adapter,
          config,
          mode,
        });
      } catch (e) {
        metrics.recordRSC("error");
        rscEndpointRouterLog.error("action request failed", {
          errorName: e instanceof Error ? e.name : "UnknownError",
        });
        return jsonErrorResponse(
          HttpStatus.INTERNAL_SERVER_ERROR,
          "action failed",
        );
      }
    }

    if (sub === "manifest") {
      metrics.recordRSC("manifest");
      return handler.handleManifest();
    }

    if (sub === "payload") {
      metrics.recordRSC("page");
      return handlePayloadEndpoint({ handler, searchParams: url.searchParams });
    }

    if (sub === "page") {
      metrics.recordRSC("page");
      return handler.handlePage("/", url.searchParams, nonce);
    }

    if (sub === "stream") {
      metrics.recordRSC("stream");
      return handleStreamEndpoint(url.searchParams);
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
      headers: { "cache-control": "no-store" },
    });
  }
}

async function handleModuleEndpoint({
  req,
  searchParams,
  projectDir,
  projectId,
  projectSlug,
  contentSourceId,
  releaseId,
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
  try {
    const modulePath = await resolveModuleEndpointPath(rel, projectDir, adapter, config);
    if (!modulePath) {
      return new Response("Not Found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    const adapterId = getBrowserModuleAdapterId(adapter);
    const configHash = await computeHash(stableSerialize(config ?? null));
    const projectKey = projectId ?? projectSlug ?? projectDir;
    const cacheKey = [
      adapterId,
      projectKey,
      contentSourceId ?? "",
      releaseId ?? "",
      configHash,
      modulePath,
    ].join("\0");
    const result = await browserModuleBuilds.getOrBuild({
      cacheKey,
      projectKey,
      build: async () => {
        const importMapJson = await buildImportMapJson({ projectDir, config });
        return bundleBrowserModuleWithMetadata(modulePath, {
          adapter,
          projectDir,
          config,
          projectSlug,
          importMapJson,
        });
      },
      validate: async (bundle) => {
        const importMapJson = await buildImportMapJson({ projectDir, config });
        if (await computeHash(importMapJson) !== bundle.importMapHash) return false;
        return validateBrowserModuleBundle(bundle, { adapter, projectDir });
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
    bundle.contentHash.length + bundle.importMapHash.length;
  for (const dependency of bundle.dependencies) {
    size += dependency.path.length + dependency.contentHash.length;
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

async function resolveModuleEndpointPath(
  rel: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
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

  try {
    if (!(await adapter.fs.exists(modulePath))) return null;
    if (
      !(await hasTrustedPathMetadata({
        adapter,
        projectDir,
        rootRelative,
        pathRelativeToRoot,
      }))
    ) return null;
    if (!(await isTrustedBrowserModuleEntry(modulePath, adapter))) return null;
  } catch (error) {
    rscEndpointRouterLog.debug("module lookup failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }

  return modulePath;
}

async function hasTrustedPathMetadata(options: {
  projectDir: string;
  rootRelative: string;
  pathRelativeToRoot: string;
  adapter: RuntimeAdapter;
}): Promise<boolean> {
  const segments = [options.rootRelative, options.pathRelativeToRoot]
    .flatMap((path) => path.split("/"))
    .filter(Boolean);
  if (segments.length < 2 || segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  let parent = normalizePath(options.projectDir);
  try {
    for (const [index, segment] of segments.entries()) {
      let matchingEntry:
        | { isFile: boolean; isDirectory: boolean; isSymlink: boolean }
        | undefined;
      for await (const entry of options.adapter.fs.readDir(parent)) {
        if (entry.name === segment) {
          matchingEntry = entry;
          break;
        }
      }

      const isLast = index === segments.length - 1;
      if (
        !matchingEntry || matchingEntry.isSymlink ||
        (isLast ? !matchingEntry.isFile : !matchingEntry.isDirectory)
      ) {
        return false;
      }
      parent = normalizePath(joinPath(parent, segment));
    }
  } catch (error) {
    rscEndpointRouterLog.debug("module path metadata inspection failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }

  return true;
}

async function isTrustedBrowserModuleEntry(
  modulePath: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  try {
    const analysis = await analyzeComponent(modulePath, adapter.fs);
    return analysis.type === "client" && !analysis.hasUseServer;
  } catch (error) {
    rscEndpointRouterLog.debug("client module analysis failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

/** Extract name parameter with fallback to "World" */
function getNameParam(searchParams: URLSearchParams): string {
  return searchParams.get("name")?.trim() || "World";
}

async function handlePayloadEndpoint({
  handler,
  searchParams,
}: {
  handler: RSCDevServerHandler;
  searchParams: URLSearchParams;
}): Promise<Response> {
  return handler.handleRender("/", searchParams);
}

function handleStreamEndpoint(searchParams: URLSearchParams): Response {
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
    },
  });
}
