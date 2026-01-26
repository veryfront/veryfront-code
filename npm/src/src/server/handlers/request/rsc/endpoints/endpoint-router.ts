/**
 * RSC endpoint router and orchestrator
 * @module rsc-endpoints/endpoint-router
 */
import * as dntShim from "../../../../../../_dnt.shims.js";


import { HTTP_SERVER_ERROR, isRSCEnabled, serverLogger } from "../../../../../utils/index.js";
import { metrics } from "../../../../../observability/simple-metrics/index.js";
import { HttpStatus, jsonErrorResponse } from "../../../../../platform/compat/http/responses.js";
import { isWithinDirectory, joinPath } from "../../../../../utils/path-utils.js";
import { escapeHtml } from "../../../../../html/html-escape.js";
import type { RuntimeAdapter } from "../../../../../platform/adapters/base.js";
import type { RSCDevServerHandler } from "../handlers/index.js";
import { handleActionRequest } from "./action-handler.js";
import { getRSCHandler } from "./handler-registry.js";
import { handleClientScript, handleDomScript } from "./script-handlers.js";
import type { RSCEndpointParams } from "./types.js";

/**
 * Handle RSC endpoints
 * @param params - RSC endpoint parameters
 * @returns Response or null if not an RSC endpoint
 */
export async function handleRSCEndpoint(
  { req, pathname, projectDir, adapter, config }: RSCEndpointParams,
): Promise<dntShim.Response | null> {
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
    return new dntShim.Response("Flight endpoint removed. Use custom RSC endpoints.", { status: 410 });
  }

  if (!isRSCEnabled(config)) {
    return null;
  }

  const url = new URL(req.url);
  const handler = getRSCHandler(projectDir);

  try {
    if (sub.startsWith("render/")) {
      return handler.handleRender(sub.replace("render/", ""), url.searchParams, req);
    }
    if (sub === "render") {
      return handler.handleRender("/", url.searchParams, req);
    }
    if (sub.startsWith("page/")) {
      metrics.recordRSC("page");
      return handler.handlePage(sub.replace("page/", ""), url.searchParams);
    }
    if (sub.startsWith("stream/")) {
      metrics.recordRSC("stream");
      return handler.handleStream(sub.replace("stream/", ""), url.searchParams);
    }

    switch (sub) {
      case "probe":
        return new dntShim.Response(JSON.stringify({ ok: true, rsc: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

      case "action":
        if (req.method !== "POST") {
          return new dntShim.Response("Method Not Allowed", { status: 405 });
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
        return handlePayloadEndpoint({ handler, searchParams: url.searchParams });

      case "hydrator.js":
      case "hydrate.js":
        return handler.handleHydratorScript();

      case "module":
        return handleModuleEndpoint({ searchParams: url.searchParams, projectDir, adapter });

      case "page":
        metrics.recordRSC("page");
        return handler.handlePage("/", url.searchParams);

      case "stream":
        metrics.recordRSC("stream");
        return handleStreamEndpoint(url.searchParams);

      default:
        return null;
    }
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
      serverLogger.debug("[RSCEndpointRouter] Failed to record metrics", metricsError);
    }

    serverLogger.debug("[rsc][dev] endpoint failed", e);
    return new dntShim.Response("Internal Error", { status: HTTP_SERVER_ERROR });
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
}): Promise<dntShim.Response> {
  const relParam = searchParams.get("rel");
  if (!relParam) {
    return new dntShim.Response("Missing rel query parameter", {
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
      if (!(await adapter.fs.exists(modulePath))) {
        continue;
      }

      const source = await adapter.fs.readFile(modulePath);
      return new dntShim.Response(source, {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    } catch (error) {
      serverLogger.debug("[RSCEndpointRouter] module lookup failed", { modulePath, error });
      return new dntShim.Response("Internal Error", { status: HTTP_SERVER_ERROR });
    }
  }

  return new dntShim.Response("Not Found", { status: 404 });
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
}): Promise<dntShim.Response> {
  let modules: string[] = [];

  try {
    const manifestResponse = await handler.handleManifest();
    if (manifestResponse.ok) {
      const manifestData = await manifestResponse.json();
      const componentPaths = manifestData?.components;

      if (componentPaths && typeof componentPaths === "object") {
        modules = Object.values(componentPaths).filter(
          (value): value is string => typeof value === "string" && value.length > 0,
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

  return new dntShim.Response(
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

function handleStreamEndpoint(searchParams: URLSearchParams): dntShim.Response {
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

  return new dntShim.Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
    },
  });
}
