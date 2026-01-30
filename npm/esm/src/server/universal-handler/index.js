/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */
import * as dntShim from "../../../_dnt.shims.js";
import { endRequest, isEnabled as isPerfEnabled, startRequest, startTimer, timeAsync, } from "../../utils/index.js";
import { getBaseLogger } from "../../utils/logger/logger.js";
import { runWithRequestContextAsync, } from "../../utils/logger/request-context.js";
const logger = getBaseLogger("SERVER");
import { requestTracker } from "./request-tracker.js";
import { projectIsolation } from "./project-isolation.js";
import { isExtendedFSAdapter } from "../../platform/adapters/fs/wrapper.js";
import { metrics } from "../../observability/simple-metrics/index.js";
import { endServerSpan, extractContext, setSpanAttributes, startServerSpan, withContext, withSpan, } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
import { getTimeoutFromEnv } from "../../middleware/builtin/timeout.js";
import { parseProjectDomain } from "../utils/domain-parser.js";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.js";
import { parseProxyEnvironment } from "./proxy-environment.js";
import { getErrorMessage } from "../../errors/veryfront-error.js";
import { runtime } from "../../platform/adapters/detect.js";
import { cwd } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { RouteRegistry } from "../../routing/registry/index.js";
import { SecurityConfigLoader } from "../../security/http/config.js";
import { getConfig } from "../../config/loader.js";
import { createRequestContext } from "../context/request-context.js";
import { buildEnrichedContext } from "../context/enriched-context.js";
import { computeContentSourceId } from "../../cache/keys.js";
import { AuthHandler } from "../../security/http/auth.js";
import { CorsHandler } from "../handlers/response/cors.js";
import { HealthHandler } from "../handlers/monitoring/health.js";
import { MetricsHandler } from "../handlers/monitoring/metrics.js";
import { ClientLogHandler } from "../handlers/monitoring/client-log.js";
import { MemoryDebugHandler } from "../handlers/monitoring/memory.js";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.js";
import { DevFileHandler } from "../handlers/dev/files/index.js";
import { DebugContextHandler } from "../handlers/dev/debug-context.js";
import { StylesCSSHandler } from "../handlers/dev/styles-css-handler.js";
import { StudioEndpointsHandler } from "../handlers/studio/endpoints.js";
import { StaticHandler } from "../handlers/request/static.js";
import { SnippetHandler } from "../handlers/request/snippet-handler.js";
import { LibModulesHandler } from "../handlers/request/lib-modules-handler.js";
import { CSSHandler } from "../handlers/request/css-handler.js";
import { RSCHandler } from "../handlers/request/rsc/index.js";
import { ModuleHandler } from "../handlers/request/module/index.js";
import { ApiHandlerWrapper } from "../handlers/request/api/index.js";
import { SSRHandler } from "../handlers/request/ssr/index.js";
import { NotFoundHandler } from "../handlers/response/not-found.js";
import { HMRHandler } from "../handlers/preview/hmr-handler.js";
import { MarkdownPreviewHandler } from "../handlers/preview/markdown-preview-handler.js";
import { OpenAPIHandler } from "../handlers/request/openapi-handler.js";
import { OpenAPIDocsHandler } from "../handlers/request/openapi-docs-handler.js";
import { DevDashboardHandler } from "../handlers/dev/dashboard/index.js";
import { ProjectsHandler } from "../handlers/dev/projects/index.js";
// Re-export from dedicated module for lightweight imports
export { parseProxyEnvironment } from "./proxy-environment.js";
/** Check if host is a private/internal IP address */
function isInternalHost(host) {
    const hostname = host.split(":")[0] ?? "";
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return true;
    }
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ipv4Match)
        return false;
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10)
        return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31)
        return true; // 172.16.0.0/12
    if (a === 192 && b === 168)
        return true; // 192.168.0.0/16
    return false;
}
/** Monitoring paths that should skip domain lookup */
const MONITORING_PATHS = new Set([
    "/healthz",
    "/readyz",
    "/_health",
    "/_metrics",
]);
/** Request timeout in milliseconds (configurable via REQUEST_TIMEOUT_MS env var) */
const REQUEST_TIMEOUT_MS = getTimeoutFromEnv();
/** HTTP 504 Gateway Timeout status code */
const HTTP_GATEWAY_TIMEOUT = 504;
/** Sentinel value for timeout detection (avoids string comparison) */
const TIMEOUT_SENTINEL = Symbol("request_timeout");
/** Check if request path is a monitoring endpoint that should skip domain lookup */
function isMonitoringPath(pathname) {
    return MONITORING_PATHS.has(pathname);
}
/** Lightweight paths that should skip concurrency limiting (modules, static assets) */
const LIGHTWEIGHT_PATH_PREFIXES = [
    "/_vf_modules/",
    "/_veryfront/modules/",
    "/_veryfront/preview-hmr.js",
    "/_veryfront/studio-bridge.js",
    "/_vf/css/",
    "/_lib_modules/",
];
/**
 * Check if request path is lightweight (module requests, static assets).
 * These paths should skip per-project concurrency limiting because:
 * 1. They're fast once initialized (no SSR rendering)
 * 2. Many are requested concurrently during page hydration
 * 3. They share initialization overhead (one slow init benefits all)
 */
function isLightweightPath(pathname) {
    for (const prefix of LIGHTWEIGHT_PATH_PREFIXES) {
        if (pathname.startsWith(prefix))
            return true;
    }
    return false;
}
/**
 * Create a universal, runtime-agnostic HTTP handler using the provided adapter.
 *
 * This implementation uses a modular handler-based architecture with:
 * - RouteRegistry for managing handlers
 * - Priority-based handler execution
 * - Clean separation of concerns
 * - Easy extensibility
 */
export function createVeryfrontHandler(projectDir, adapter, opts = { projectDir }) {
    const isDebugEnabled = !!(opts.debug || adapter.env.get("VERYFRONT_DEBUG"));
    function logDebug(message, extra) {
        if (!isDebugEnabled)
            return;
        if (extra) {
            logger.debug(message, extra);
            return;
        }
        logger.debug(message);
    }
    logDebug("[universal] handler initialized", { projectDir });
    const securityLoader = new SecurityConfigLoader(projectDir, adapter, opts.config);
    let config = opts.config;
    const configPromise = opts.config ? Promise.resolve(opts.config) : getConfig(projectDir, adapter)
        .then((c) => {
        config = c;
        return c;
    })
        .catch((error) => {
        logger.warn("[universal] Failed to load config, using defaults", {
            error: getErrorMessage(error),
        });
        return undefined;
    });
    const registry = new RouteRegistry({
        debug: opts.debug,
        enableMetrics: true,
    });
    const apiHandler = new ApiHandlerWrapper(projectDir, adapter);
    registry.registerAll([
        new AuthHandler(), // Priority: 0 (CRITICAL)
        new HMRHandler(), // Priority: 25 (preview mode HMR WebSocket)
        new CorsHandler(), // Priority: 50
        new HealthHandler(), // Priority: 100 (HIGH)
        new MetricsHandler(), // Priority: 100 (HIGH)
        new MemoryDebugHandler(), // Priority: 100 (HIGH, memory profiling endpoints)
        new ClientLogHandler(), // Priority: 200 (HIGH, dev only)
        new DevEndpointsHandler(), // Priority: 300 (HIGH, dev only)
        new StylesCSSHandler(), // Priority: 300 (HIGH, serves styles.css for HMR)
        new DebugContextHandler(), // Priority: 300 (HIGH, dev only - context debugging)
        new OpenAPIHandler(), // Priority: 300 (HIGH, serves /_openapi.json)
        new OpenAPIDocsHandler(), // Priority: 300 (HIGH, serves /_docs with Scalar UI)
        new DevDashboardHandler(), // Priority: 300 (HIGH, dev only - unified dev dashboard at /_dev)
        new ProjectsHandler(), // Priority: HIGH (multi-project mode landing page with React UI)
        new StudioEndpointsHandler(), // Priority: 300 (HIGH, Studio iframe scripts)
        new CSSHandler(), // Priority: 300 (HIGH, serves /_vf/css/[hash].css)
        new DevFileHandler(), // Priority: 400 (dev only)
        new SnippetHandler(), // Priority: 450 (before static, handles @/ component previews)
        new StaticHandler(), // Priority: 500 (MEDIUM_STATIC)
        new LibModulesHandler(), // Priority: 550 (MEDIUM_LIB_MODULES, self-hosted veryfront modules)
        new RSCHandler(), // Priority: 600 (MEDIUM, runs before static to expose RSC endpoints)
        new ModuleHandler(), // Priority: 600 (MEDIUM)
        apiHandler, // Priority: 700 (MEDIUM)
        new MarkdownPreviewHandler(), // Priority: 900 (preview/dev only - serves .md files with GitHub styling)
        new SSRHandler(), // Priority: 1000 (LOW)
        new NotFoundHandler(), // Priority: 10000 (FALLBACK)
    ]);
    const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;
    const localAdapterCache = new Map();
    const standardProjectDirs = ["data/projects", "projects", "examples"];
    const localProjectCache = new Map();
    async function findLocalProjectPath(slug, headerPath) {
        if (headerPath) {
            localProjectCache.set(slug, headerPath);
            return headerPath;
        }
        const cached = localProjectCache.get(slug);
        if (cached)
            return cached;
        for (const dir of standardProjectDirs) {
            const projectPath = `${dir}/${slug}`;
            try {
                const stat = await adapter.fs.stat(projectPath);
                if (!stat?.isDirectory)
                    continue;
                const [hasApp, hasPages, hasComponents] = await Promise.all([
                    adapter.fs.stat(`${projectPath}/app`).then((s) => s?.isDirectory)
                        .catch(() => false),
                    adapter.fs.stat(`${projectPath}/pages`).then((s) => s?.isDirectory)
                        .catch(() => false),
                    adapter.fs
                        .stat(`${projectPath}/components`)
                        .then((s) => s?.isDirectory)
                        .catch(() => false),
                ]);
                if (!hasApp && !hasPages && !hasComponents)
                    continue;
                const absolutePath = projectPath.startsWith("/") ? projectPath : `${cwd()}/${projectPath}`;
                localProjectCache.set(slug, absolutePath);
                logger.debug("[universal] Discovered local project", {
                    slug,
                    path: absolutePath,
                });
                return absolutePath;
            }
            catch {
                // Directory doesn't exist, continue
            }
        }
        return undefined;
    }
    const readyPromise = isProxyMode ? Promise.resolve() : apiHandler.initialize().catch((error) => {
        logger.error("[universal] API handler initialization failed", {
            error: getErrorMessage(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
    });
    if (isProxyMode) {
        logger.debug("[universal] Running in proxy mode - lazy initialization enabled");
    }
    const handler = async (req) => {
        const perfEnabled = isPerfEnabled();
        const perfRequestId = perfEnabled
            ? (req.headers.get("x-request-id") ?? dntShim.crypto.randomUUID())
            : undefined;
        if (perfRequestId)
            startRequest(perfRequestId);
        const stopTotal = startTimer("total");
        const url = new URL(req.url);
        // Early return for monitoring paths - skip expensive context building
        // (domain lookups, project resolution, enriched context, etc.)
        // Health checks (/healthz, /readyz, /_health) and metrics (/_metrics) need minimal context
        // but still need auth/security config loaded
        if (isMonitoringPath(url.pathname)) {
            try {
                // Wait for ready and security config to load (needed for auth checks)
                await readyPromise;
                if (!isProxyMode) {
                    await securityLoader.ensureLoaded();
                }
                const minimalCtx = {
                    projectDir,
                    adapter,
                    securityConfig: securityLoader.getSecurityConfig(),
                    cspUserHeader: securityLoader.getCspUserHeader(),
                    debug: opts.debug,
                    config,
                };
                const response = await registry.execute(req, minimalCtx);
                return response ?? new dntShim.Response("Not Found", { status: 404 });
            }
            finally {
                stopTotal();
                if (perfRequestId)
                    endRequest(perfRequestId);
            }
        }
        const trackingRequestId = req.headers.get("x-request-id") ??
            dntShim.crypto.randomUUID();
        // Extract request context for logging
        const host = req.headers.get("host") ?? url.host;
        const domain = host.replace(/:\d+$/, "");
        const projectSlugHeader = req.headers.get("x-project-slug") ?? undefined;
        const projectIdHeader = req.headers.get("x-project-id") ?? undefined;
        const releaseIdHeader = req.headers.get("x-release-id") ?? undefined;
        const branchIdHeader = req.headers.get("x-branch-id") ?? undefined;
        const branchNameHeader = req.headers.get("x-branch-name") ?? undefined;
        // Create request-scoped logger with bound context
        const reqLogger = logger.child({
            requestId: trackingRequestId,
            request_url: req.url,
            domain,
            project_slug: projectSlugHeader,
            project_id: projectIdHeader,
            release_id: releaseIdHeader,
            branch_id: branchIdHeader,
            branch_name: branchNameHeader,
            pathname: url.pathname,
        });
        // Create request context for AsyncLocalStorage propagation
        const loggerContext = {
            logger: reqLogger,
            requestId: trackingRequestId,
            projectSlug: projectSlugHeader,
            projectId: projectIdHeader,
            domain,
        };
        // Run the entire request within the AsyncLocalStorage context
        // This makes the request-scoped logger available to ALL code in the call stack
        return runWithRequestContextAsync(loggerContext, async () => {
            const parentContext = extractContext(req.headers);
            const spanInfo = startServerSpan(req.method, url.pathname, parentContext);
            const span = spanInfo?.span;
            if (span) {
                setSpanAttributes(span, {
                    "http.url": req.url,
                    "http.host": req.headers.get("host") || url.host,
                    "http.scheme": url.protocol.replace(":", ""),
                });
            }
            const earlyProjectSlug = req.headers.get("x-project-slug") || undefined;
            const earlyEnv = req.headers.get("x-environment") || undefined;
            const earlyReleaseId = req.headers.get("x-release-id") || undefined;
            requestTracker.start(trackingRequestId, earlyProjectSlug, url.pathname, req.method, earlyEnv || undefined, earlyReleaseId || undefined);
            // Skip concurrency limiting for lightweight paths (modules, static assets)
            // These requests are fast once initialized and shouldn't block each other
            const shouldCheckIsolation = !isLightweightPath(url.pathname);
            const isolationCheck = shouldCheckIsolation
                ? projectIsolation.checkRequest(earlyProjectSlug)
                : { allowed: true };
            if (!isolationCheck.allowed) {
                requestTracker.complete(trackingRequestId, 503, false);
                const message = isolationCheck.reason === "circuit_open"
                    ? `Service temporarily unavailable for project. Retry after ${Math.ceil((isolationCheck.waitTimeMs || 0) / 1000)} seconds.`
                    : "Too many concurrent requests for this project. Please retry.";
                const response = new dntShim.Response(JSON.stringify({
                    error: message,
                    reason: isolationCheck.reason,
                    retryAfterMs: isolationCheck.waitTimeMs,
                }), {
                    status: 503,
                    headers: {
                        "Content-Type": "application/json",
                        ...(isolationCheck.waitTimeMs
                            ? {
                                "Retry-After": String(Math.ceil(isolationCheck.waitTimeMs / 1000)),
                            }
                            : {}),
                    },
                });
                endServerSpan(span, response.status);
                return response;
            }
            // Only track isolation for heavyweight requests (SSR, API routes)
            if (shouldCheckIsolation) {
                projectIsolation.startRequest(earlyProjectSlug);
            }
            try {
                await readyPromise;
                await timeAsync("security:load", async () => {
                    if (isProxyMode)
                        return;
                    await securityLoader.ensureLoaded();
                });
                await timeAsync("config:load", async () => {
                    await configPromise;
                });
                const executeHandler = async () => {
                    const reqCtx = createRequestContext(req, opts.envConfig);
                    const wsSlugOverride = url.searchParams.get("x-project-slug") ||
                        undefined;
                    const proxyProjectPath = req.headers.get("x-project-path") || undefined;
                    let proxyEnv = parseProxyEnvironment(req.headers.get("x-environment") ||
                        url.searchParams.get("x-environment"));
                    const forwardedHost = req.headers.get("x-forwarded-host") || undefined;
                    const host = forwardedHost || req.headers.get("host") || url.host;
                    const parsedDomain = parseProjectDomain(host);
                    const configuredSlug = config?.fs?.veryfront?.projectSlug;
                    let projectSlug = reqCtx.slug || wsSlugOverride || configuredSlug ||
                        opts.defaultProjectSlug;
                    const proxyToken = reqCtx.token || undefined;
                    const proxyReleaseId = req.headers.get("x-release-id") || undefined;
                    const proxyProjectId = req.headers.get("x-project-id") || undefined;
                    const proxyContentSourceId = req.headers.get("x-content-source-id") ||
                        undefined;
                    let projectId = proxyProjectId ||
                        opts.defaultProjectId;
                    let releaseId = proxyReleaseId;
                    let environmentName;
                    logger.debug("[universal] config state", {
                        hasConfig: !!config,
                        hasFsConfig: !!config?.fs,
                        hasVeryfrontConfig: !!config?.fs?.veryfront,
                        configuredSlug,
                        reqCtxSlug: reqCtx.slug,
                        reqCtxMode: reqCtx.mode,
                        reqCtxBranch: reqCtx.branch,
                        parsedDomainSlug: parsedDomain.slug,
                        finalProjectSlug: projectSlug,
                        isVeryfrontDomain: parsedDomain.isVeryfrontDomain,
                        isLocalDev: reqCtx.isLocalDev,
                        proxyReleaseId,
                        proxyProjectId,
                    });
                    // Monitoring paths have early return above, so only check for internal hosts
                    const shouldSkipDomainLookup = isInternalHost(host);
                    if (!projectSlug &&
                        !parsedDomain.isVeryfrontDomain &&
                        config?.fs?.veryfront &&
                        !shouldSkipDomainLookup) {
                        const effectiveToken = proxyToken || config.fs.veryfront.apiToken ||
                            "";
                        const baseUrl = config.fs.veryfront
                            .baseUrl ||
                            config.fs.veryfront.apiBaseUrl ||
                            "https://api.veryfront.com";
                        const lookupHost = forwardedHost || host;
                        if (effectiveToken) {
                            logger.debug("[universal] Custom domain detected, looking up project", {
                                host: lookupHost,
                                originalHost: host,
                                forwardedHost,
                                hasProxyToken: !!proxyToken,
                                hasConfigToken: !!config.fs.veryfront.apiToken,
                            });
                            const lookupResult = await withSpan(SpanNames.DOMAIN_LOOKUP, () => lookupProjectByDomain(lookupHost, {
                                apiBaseUrl: baseUrl,
                                apiToken: effectiveToken,
                            }), { "domain.host": lookupHost, "domain.original_host": host });
                            if (lookupResult) {
                                projectSlug = lookupResult.project_slug;
                                projectId = projectId || lookupResult.project_id;
                                // Only use lookup result if proxy didn't provide releaseId
                                releaseId = releaseId || lookupResult.release_id || undefined;
                                environmentName = lookupResult.environment?.name;
                                if (!proxyEnv)
                                    proxyEnv = getEnvironmentType(lookupResult);
                                logger.debug("[universal] Domain lookup successful", {
                                    domain: host,
                                    projectSlug: lookupResult.project_slug,
                                    projectId: lookupResult.project_id,
                                    environment: proxyEnv,
                                    environmentName,
                                    releaseId: lookupResult.release_id,
                                });
                            }
                            else {
                                logger.warn("[universal] No project found for domain", {
                                    host: lookupHost,
                                });
                            }
                        }
                        else {
                            logger.warn("[universal] Cannot look up custom domain - no API token available", {
                                host: lookupHost,
                                hasProxyToken: !!proxyToken,
                                hasConfigToken: !!config?.fs?.veryfront?.apiToken,
                            });
                        }
                    }
                    if (parsedDomain.isVeryfrontDomain &&
                        parsedDomain.isDraft === false &&
                        projectSlug &&
                        !releaseId &&
                        !proxyToken && // Skip domain lookup in proxy mode - proxy already provides releaseId
                        config?.fs?.veryfront &&
                        !shouldSkipDomainLookup) {
                        const effectiveToken = proxyToken || config.fs.veryfront.apiToken ||
                            "";
                        const baseUrl = config.fs.veryfront
                            .baseUrl ||
                            config.fs.veryfront.apiBaseUrl ||
                            "https://api.veryfront.com";
                        if (effectiveToken) {
                            const lookupResult = await withSpan(SpanNames.DOMAIN_RELEASE_LOOKUP, () => lookupProjectByDomain(host, {
                                apiBaseUrl: baseUrl,
                                apiToken: effectiveToken,
                            }), { "domain.host": host, "domain.project_slug": projectSlug });
                            if (lookupResult?.release_id) {
                                releaseId = lookupResult.release_id;
                                projectId = projectId || lookupResult.project_id;
                                environmentName = environmentName ||
                                    lookupResult.environment?.name;
                                proxyEnv = "production";
                                logger.debug("[universal] Veryfront domain release lookup successful", {
                                    projectSlug,
                                    releaseId,
                                    projectId,
                                    environmentName,
                                });
                            }
                        }
                    }
                    if (parsedDomain.slug && configuredSlug &&
                        parsedDomain.slug !== configuredSlug) {
                        logDebug("[universal] Project slug mismatch", {
                            fromUrl: parsedDomain.slug,
                            fromConfig: configuredSlug,
                            usingSlug: projectSlug,
                        });
                    }
                    if (reqCtx.token) {
                        logDebug("[universal] Request context resolved", {
                            projectSlug,
                            mode: reqCtx.mode,
                            branch: reqCtx.branch,
                            environment: proxyEnv,
                            hasToken: !!reqCtx.token,
                        });
                    }
                    if (span && projectSlug) {
                        setSpanAttributes(span, {
                            "veryfront.project_slug": projectSlug,
                            "veryfront.environment": proxyEnv || "unknown",
                        });
                    }
                    // Handle veryfront domains without a project slug - serve projects page
                    // This must happen before context building which requires a project
                    const isProjectsPath = url.pathname === "/" ||
                        url.pathname.startsWith("/_projects") ||
                        url.pathname === "/_vf/api/projects";
                    if (!projectSlug &&
                        !parsedDomain.slug &&
                        parsedDomain.isVeryfrontDomain &&
                        isProjectsPath) {
                        const { PROJECTS_SHELL_HTML } = await import("../handlers/dev/projects/html-shell.js");
                        const { handleProjectsAPI } = await import("../handlers/dev/projects/api.js");
                        const { handleProjectsUI } = await import("../handlers/dev/projects/ui-handler.js");
                        if (url.pathname === "/" || url.pathname === "/_projects" ||
                            url.pathname === "/_projects/") {
                            return new dntShim.Response(PROJECTS_SHELL_HTML, {
                                status: 200,
                                headers: { "Content-Type": "text/html; charset=utf-8" },
                            });
                        }
                        if (url.pathname.startsWith("/_projects/ui/")) {
                            const response = await handleProjectsUI(req);
                            if (response)
                                return response;
                        }
                        if (url.pathname.startsWith("/_projects/api/")) {
                            const response = await handleProjectsAPI(req, {});
                            if (response)
                                return response;
                        }
                        // Handle /_vf/api/projects - discover and return local projects
                        if (url.pathname === "/_vf/api/projects") {
                            // Use native filesystem to discover local projects
                            const nativeFs = createFileSystem();
                            const basePath = cwd();
                            for (const dir of standardProjectDirs) {
                                try {
                                    const dirPath = `${basePath}/${dir}`;
                                    const dirExists = await nativeFs.exists(dirPath);
                                    if (!dirExists)
                                        continue;
                                    for await (const entry of nativeFs.readDir(dirPath)) {
                                        if (entry.name.startsWith(".") || !entry.isDirectory)
                                            continue;
                                        const projectPath = `${dirPath}/${entry.name}`;
                                        try {
                                            const [hasApp, hasPages, hasComponents] = await Promise.all([
                                                nativeFs.exists(`${projectPath}/app`),
                                                nativeFs.exists(`${projectPath}/pages`),
                                                nativeFs.exists(`${projectPath}/components`),
                                            ]);
                                            if (hasApp || hasPages || hasComponents) {
                                                localProjectCache.set(entry.name, projectPath);
                                            }
                                        }
                                        catch {
                                            // Skip entries that can't be stat'd
                                        }
                                    }
                                }
                                catch {
                                    // Directory doesn't exist, skip
                                }
                            }
                            const localProjects = Array.from(localProjectCache.entries()).map(([slug, path]) => ({
                                id: slug,
                                name: slug,
                                slug,
                                path,
                                updated_at: new Date().toISOString(),
                            }));
                            return new dntShim.Response(JSON.stringify({ data: localProjects }), {
                                status: 200,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                        return new dntShim.Response("Not found", { status: 404 });
                    }
                    let effectiveProjectDir = projectDir;
                    let effectiveAdapter = adapter;
                    const localProjectPath = projectSlug
                        ? await findLocalProjectPath(projectSlug, proxyProjectPath)
                        : undefined;
                    const isLocalProject = !!localProjectPath;
                    let effectiveConfig = config;
                    if (isLocalProject && localProjectPath) {
                        effectiveProjectDir = localProjectPath;
                        logger.debug("[universal] Using local project (filesystem-first)", {
                            projectSlug,
                            projectDir: effectiveProjectDir,
                        });
                        if (!localAdapterCache.has(effectiveProjectDir)) {
                            const baseAdapter = await runtime.get();
                            localAdapterCache.set(effectiveProjectDir, baseAdapter);
                            logger.debug("[universal] Created local adapter for project", {
                                projectSlug,
                                projectDir: effectiveProjectDir,
                            });
                        }
                        effectiveAdapter = localAdapterCache.get(effectiveProjectDir);
                        try {
                            effectiveConfig = await timeAsync("config:load-project", () => getConfig(effectiveProjectDir, effectiveAdapter));
                            logger.debug("[universal] Loaded project-specific config", {
                                projectSlug,
                                projectDir: effectiveProjectDir,
                                layout: effectiveConfig?.layout,
                                router: effectiveConfig?.router,
                            });
                        }
                        catch (error) {
                            logger.warn("[universal] Failed to load project config, using defaults", {
                                projectSlug,
                                projectDir: effectiveProjectDir,
                                error: getErrorMessage(error),
                            });
                        }
                    }
                    else if (isProxyMode && projectSlug && proxyToken) {
                        // Load config in proxy mode so enrichedContext can be created with correct environment
                        // Must wrap in runWithContext to set project context for MultiProjectFSAdapter
                        try {
                            effectiveConfig = await timeAsync("config:load-proxy-project", () => {
                                // Access runWithContext via the fs adapter (ExtendedFileSystemAdapter)
                                if (isExtendedFSAdapter(effectiveAdapter.fs) &&
                                    effectiveAdapter.fs.runWithContext) {
                                    return effectiveAdapter.fs.runWithContext(projectSlug, proxyToken, () => getConfig(effectiveProjectDir, effectiveAdapter, {
                                        cacheKey: projectId || projectSlug,
                                    }), projectId, {
                                        productionMode: proxyEnv === "production",
                                        releaseId,
                                        branch: reqCtx.branch || parsedDomain.branch || null,
                                        environmentName,
                                    });
                                }
                                return getConfig(effectiveProjectDir, effectiveAdapter, {
                                    cacheKey: projectId || projectSlug,
                                });
                            });
                            logger.debug("[universal] Loaded config in proxy mode", {
                                projectSlug,
                                hasConfig: !!effectiveConfig,
                                layout: effectiveConfig?.layout,
                                router: effectiveConfig?.router,
                            });
                        }
                        catch (error) {
                            logger.warn("[universal] Failed to load proxy config, using defaults", {
                                projectSlug,
                                error: getErrorMessage(error),
                            });
                        }
                    }
                    let resolvedEnvironment = proxyEnv === "preview" || proxyEnv === "production"
                        ? proxyEnv
                        : reqCtx.mode;
                    if (isProxyMode && resolvedEnvironment === "production" && projectSlug &&
                        !releaseId &&
                        !isLocalProject) {
                        logger.error("[universal] Missing releaseId in proxy mode (production)", {
                            projectSlug,
                            projectId,
                            environmentName,
                            host,
                            proxyEnv,
                            resolvedEnvironment,
                        });
                        return new dntShim.Response(JSON.stringify({
                            error: "Missing releaseId for production request in proxy mode",
                            projectSlug,
                            environment: resolvedEnvironment,
                        }), { status: 502, headers: { "Content-Type": "application/json" } });
                    }
                    // In standalone (non-proxy) mode without releaseId, fallback to configured environment
                    // or preview by default. This allows test servers and local development to work.
                    const isStandaloneWithoutRelease = !isProxyMode &&
                        resolvedEnvironment === "production" &&
                        !releaseId && !reqCtx.isLocalDev && !isLocalProject;
                    if (isStandaloneWithoutRelease) {
                        const fallbackEnv = opts.defaultEnvironment ?? "preview";
                        logger.debug("[universal] Standalone mode without releaseId, using fallback environment", {
                            projectSlug,
                            resolvedEnvironment,
                            fallbackEnv,
                        });
                        resolvedEnvironment = fallbackEnv;
                        // If falling back to production environment, generate a synthetic releaseId
                        // to satisfy cache key requirements
                        if (fallbackEnv === "production" && !releaseId) {
                            releaseId = "standalone-dev";
                            logger.debug("[universal] Using synthetic releaseId for standalone production mode", {
                                projectSlug,
                                releaseId,
                            });
                        }
                    }
                    // Use proxy header if available, otherwise compute using shared utility
                    // Note: Monitoring paths have early return above, so they never reach here
                    const contentSourceId = proxyContentSourceId ?? computeContentSourceId(reqCtx.isLocalDev || isLocalProject, resolvedEnvironment, reqCtx.branch, releaseId);
                    const enrichedContext = effectiveConfig && projectSlug
                        ? buildEnrichedContext({
                            projectId: projectId ?? projectSlug,
                            projectSlug,
                            projectDir: effectiveProjectDir,
                            token: isLocalProject ? "" : (proxyToken ?? ""),
                            environment: resolvedEnvironment,
                            branch: reqCtx.branch,
                            isLocalDev: reqCtx.isLocalDev || isLocalProject,
                            contentSourceId,
                            parsedDomain,
                            adapter: effectiveAdapter,
                            config: effectiveConfig,
                            releaseId,
                            environmentName,
                            moduleServerUrl: opts.moduleServerUrl,
                            debug: opts.debug,
                        })
                        : undefined;
                    const ctx = {
                        projectDir: effectiveProjectDir,
                        adapter: effectiveAdapter,
                        moduleServerUrl: opts.moduleServerUrl,
                        securityConfig: securityLoader.getSecurityConfig(),
                        cspUserHeader: securityLoader.getCspUserHeader(),
                        debug: opts.debug,
                        config: effectiveConfig,
                        parsedDomain,
                        projectSlug,
                        projectId,
                        releaseId,
                        proxyToken: isLocalProject ? undefined : proxyToken,
                        environmentName,
                        resolvedEnvironment,
                        requestContext: { ...reqCtx, mode: resolvedEnvironment },
                        routeRegistry: registry,
                        enriched: enrichedContext,
                    };
                    await timeAsync("metrics:inc-request", () => metrics.incRequest());
                    const response = await withSpan(SpanNames.HANDLER_EXECUTE, () => registry.execute(req, ctx), {
                        "handler.project_slug": projectSlug || "unknown",
                        "handler.path": url.pathname,
                        "handler.method": req.method,
                    });
                    if (response)
                        return response;
                    logDebug("[universal] No handler produced response (unexpected)", {
                        path: url.pathname,
                    });
                    return new dntShim.Response("Internal Server Error", { status: 500 });
                };
                // Note: Monitoring paths have early return above, so timeout always applies here
                let response;
                let error;
                let timeoutId;
                try {
                    const executeWithContext = spanInfo?.context
                        ? () => withContext(spanInfo.context, executeHandler)
                        : executeHandler;
                    response = await Promise.race([
                        executeWithContext(),
                        new Promise((_, reject) => {
                            timeoutId = dntShim.setTimeout(() => reject(TIMEOUT_SENTINEL), REQUEST_TIMEOUT_MS);
                        }),
                    ]);
                }
                catch (e) {
                    if (e === TIMEOUT_SENTINEL) {
                        logger.warn("[universal] Request timed out", {
                            path: url.pathname,
                            method: req.method,
                            timeoutMs: REQUEST_TIMEOUT_MS,
                        });
                        response = new dntShim.Response(JSON.stringify({
                            error: "Request timeout",
                            timeoutMs: REQUEST_TIMEOUT_MS,
                            path: url.pathname,
                        }), {
                            status: HTTP_GATEWAY_TIMEOUT,
                            headers: { "Content-Type": "application/json" },
                        });
                    }
                    else {
                        error = e instanceof Error ? e : new Error(String(e));
                        response = new dntShim.Response("Internal Server Error", { status: 500 });
                    }
                }
                finally {
                    if (timeoutId !== undefined)
                        clearTimeout(timeoutId);
                }
                endServerSpan(span, response.status, error);
                const isTimeout = response.status === HTTP_GATEWAY_TIMEOUT;
                requestTracker.complete(trackingRequestId, response.status, isTimeout);
                // Only complete isolation tracking if we started it (heavyweight requests)
                if (shouldCheckIsolation) {
                    projectIsolation.completeRequest(earlyProjectSlug, isTimeout);
                }
                return response;
            }
            finally {
                stopTotal();
                if (perfRequestId)
                    endRequest(perfRequestId);
            }
        });
    };
    handler.ready = readyPromise;
    return handler;
}
export { RouteRegistry } from "../../routing/registry/index.js";
export { BaseHandler } from "../handlers/response/base.js";
