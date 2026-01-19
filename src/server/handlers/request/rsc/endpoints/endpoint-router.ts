/**
 * RSC endpoint router and orchestrator
 * @module rsc-endpoints/endpoint-router
 */

import { HTTP_SERVER_ERROR } from "#veryfront/utils";
import { metrics } from "#veryfront/observability/simple-metrics/index.ts";
import { serverLogger } from "#veryfront/utils";
import { isRSCEnabled } from "#veryfront/utils";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { getRSCHandler } from "./handler-registry.ts";
import { handleActionRequest } from "./action-handler.ts";
import { handleClientScript, handleDomScript } from "./script-handlers.ts";
import type { RSCEndpointParams } from "./types.ts";
import type { RSCDevServerHandler } from "../handlers/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isWithinDirectory, joinPath } from "#veryfront/utils/path-utils.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";

/**
 * Handle RSC endpoints
 * @param params - RSC endpoint parameters
 * @returns Response or null if not an RSC endpoint
 */
export async function handleRSCEndpoint(
  { req, pathname, projectDir, adapter, config }: RSCEndpointParams,
): Promise<Response | null> {
  // Only handle RSC endpoints
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
  // regardless of RSC being enabled
  if (sub === "flight_page") {
    return new Response(
      "Flight endpoint removed. Use custom RSC endpoints.",
      { status: 410 },
    );
  }

  // Check if RSC feature is enabled via feature flag for other endpoints
  if (!isRSCEnabled(config)) {
    return null; // Not enabled, let it 404
  }
  const url = new URL(req.url);
  const handler = getRSCHandler(projectDir);

  try {
    switch (sub) {
      case "probe":
        return new Response(JSON.stringify({ ok: true, rsc: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

      case "action":
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        metrics.recordRSC("action");
        try {
          return await handleActionRequest({ req, projectDir, adapter });
        } catch (e) {
          metrics.recordRSC("error");
          return jsonErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR,
            e instanceof Error ? e.message : String(e),
          );
        }

      case "manifest":
        metrics.recordRSC("manifest");
        return handler.handleManifest();

      case "payload":
        metrics.recordRSC("page");
        return await handlePayloadEndpoint({
          handler,
          searchParams: url.searchParams,
        });

      case "hydrator.js":
      case "hydrate.js":
        return await handler.handleHydratorScript();

      case "module":
        return await handleModuleEndpoint({
          searchParams: url.searchParams,
          projectDir,
          adapter,
        });

      case "page":
        metrics.recordRSC("page");
        return handler.handlePage("/", url.searchParams);

      case "stream":
        metrics.recordRSC("stream");
        return handleStreamEndpoint(url.searchParams);

      default:
        // Check if it's a render request
        if (sub.startsWith("render/")) {
          const componentPath = sub.replace("render/", "");
          return handler.handleRender(componentPath, url.searchParams, req);
        }
        if (sub === "render") {
          // Allow bare /render to resolve to index
          return handler.handleRender("/", url.searchParams, req);
        }

        // Check if it's a page request with path
        if (sub.startsWith("page/")) {
          const pagePath = sub.replace("page/", "");
          metrics.recordRSC("page");
          return handler.handlePage(pagePath, url.searchParams);
        }

        // Check if it's a stream request with path
        if (sub.startsWith("stream/")) {
          const streamPath = sub.replace("stream/", "");
          metrics.recordRSC("stream");
          return handler.handleStream(streamPath, url.searchParams);
        }

        // Let outer server handle other RSC routes like hydrate.js or payload
        return null;
    }
  } catch (e) {
    if (e instanceof Error && e.message === "Component not found") {
      serverLogger.debug("[RSCEndpointRouter] component not found, deferring to legacy handler", {
        error: e.message,
      });
      return null;
    }
    try {
      metrics.recordRSC("error");
    } catch (metricsError) {
      serverLogger.debug("[RSCEndpointRouter] Failed to record metrics", metricsError);
    }
    serverLogger.debug("[rsc][dev] endpoint failed", e);
    return new Response("Internal Error", { status: HTTP_SERVER_ERROR });
  }
}

async function handleModuleEndpoint({
  searchParams,
  projectDir,
  adapter,
}: {
  searchParams: URLSearchParams;
  projectDir: string;
  adapter: RuntimeAdapter;
}): Promise<Response> {
  const relParam = searchParams.get("rel");
  if (!relParam) {
    return new Response("Missing rel query parameter", {
      status: HttpStatus.BAD_REQUEST,
      headers: { "content-type": "text/plain" },
    });
  }

  const normalizedRel = relParam.replace(/\\+/g, "/");
  const rel = normalizedRel.startsWith("/") ? normalizedRel : `/${normalizedRel}`;
  const candidateRoots = [
    joinPath(projectDir, "app"),
    joinPath(projectDir, "components"),
    joinPath(projectDir, "src"),
    projectDir,
  ];

  for (const root of candidateRoots) {
    const modulePath = joinPath(root, rel);
    if (!isWithinDirectory(root, modulePath)) {
      continue;
    }

    try {
      const exists = await adapter.fs.exists(modulePath);
      if (!exists) {
        continue;
      }

      const source = await adapter.fs.readFile(modulePath);
      return new Response(source, {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    } catch (error) {
      serverLogger.debug("[RSCEndpointRouter] module lookup failed", {
        modulePath,
        error,
      });
      return new Response("Internal Error", { status: HTTP_SERVER_ERROR });
    }
  }

  return new Response("Not Found", { status: 404 });
}

/** Extract name parameter with fallback to "World" */
function getNameParam(searchParams: URLSearchParams): string {
  const name = searchParams.get("name")?.trim();
  return name || "World";
}

async function handlePayloadEndpoint({
  handler,
  searchParams,
}: {
  handler: RSCDevServerHandler;
  searchParams: URLSearchParams;
}): Promise<Response> {
  let modules: string[] = [];
  try {
    const manifestResponse = await handler.handleManifest();
    if (manifestResponse.ok) {
      const manifestData = await manifestResponse.json();
      const componentPaths = manifestData?.components;
      if (componentPaths && typeof componentPaths === "object") {
        modules = Object.values(componentPaths).filter((value): value is string =>
          typeof value === "string" && value.length > 0
        );
      }
    }
  } catch (error) {
    serverLogger.debug("[RSCEndpointRouter] failed to read manifest for payload", error);
  }

  if (modules.length === 0) {
    modules = ["__veryfront_rsc_root__"];
  }

  const name = getNameParam(searchParams);
  const rootHtml = `<div data-slot="root">Hello ${escapeHtml(name)}</div>`;

  return new Response(
    JSON.stringify({
      html: rootHtml,
      modules,
      slots: { root: rootHtml },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-cache",
      },
    },
  );
}

function handleStreamEndpoint(searchParams: URLSearchParams): Response {
  const name = getNameParam(searchParams);
  const escapedName = escapeHtml(name);
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
