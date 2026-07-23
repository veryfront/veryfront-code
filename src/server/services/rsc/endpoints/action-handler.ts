/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { serverLogger } from "#veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  HTTP_PAYLOAD_TOO_LARGE,
} from "#veryfront/utils/constants/index.ts";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("rsc");
const JSON_MEDIA_TYPE = "application/json";

interface ActionGuardModule {
  rscActionGuard?: (
    req: Request,
    context: { id: string; args: unknown[] },
  ) => boolean | Promise<boolean>;
}

export type ActionGuardLoader = () => Promise<ActionGuardModule>;

const loadDefaultActionGuard: ActionGuardLoader = () =>
  import("#veryfront/rendering/rsc/server-action-guard.ts");

/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export async function handleActionRequest(
  params: ActionRequestParams,
): Promise<Response> {
  return await handleActionRequestWithGuardLoader(params, loadDefaultActionGuard);
}

/** @internal Guard-loader seam for deterministic failure-path tests. */
export async function handleActionRequestWithGuardLoader(
  {
    req,
    projectDir,
    projectId,
    contentSourceId,
    adapter,
    config,
    mode,
  }: ActionRequestParams,
  actionGuardLoader: ActionGuardLoader,
): Promise<Response> {
  const requestValidationError = validateActionRequest(req);
  if (requestValidationError) return requestValidationError;

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(req, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return jsonErrorResponse(HTTP_PAYLOAD_TOO_LARGE, "Request body too large");
    }
    logger.warn("Failed to parse action request body", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid JSON body");
  }

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof Response) return parseResult;

  const { id, args } = parseResult;

  const guardModule = await loadGuardModule(actionGuardLoader);
  if (guardModule instanceof Response) return guardModule;

  const guard = guardModule?.rscActionGuard;
  if (guard !== undefined && typeof guard !== "function") {
    logger.error("Action guard export is not a function");
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
  }

  if (guard) {
    try {
      const ok = await guard(req, { id, args });
      if (!ok) return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
    } catch (error) {
      logger.error("Action guard execution failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
    }
  }

  const appRoot = normalizePath(joinPath(projectDir, config?.directories?.app ?? "app"));
  const actionsRoot = normalizePath(joinPath(appRoot, "actions"));
  if (!isWithinDirectory(projectDir, appRoot) || !isWithinDirectory(appRoot, actionsRoot)) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action root");
  }

  const file = await findActionFile(actionsRoot, id, adapter);
  if (!file) {
    return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  }

  const source = await adapter.fs.readFile(file);
  const reactVersion = await resolveProjectReactVersion({ projectDir, config });
  const mod = await loadModuleFromSource(source, file, projectDir, adapter, {
    projectId: projectId ?? projectDir,
    contentSourceId: contentSourceId ??
      (mode === "development" ? "preview-main" : "production"),
    dev: mode === "development",
    mode: mode === "development" ? "preview" : "production",
    reactVersion,
  });
  const fn = mod.default ?? mod.action;

  if (typeof fn !== "function") {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action");
  }

  const result = await (fn as (...args: unknown[]) => Promise<unknown>)(...args);

  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}

function validateActionRequest(req: Request): Response | null {
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== JSON_MEDIA_TYPE) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "Content-Type must be application/json");
  }

  const fetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return jsonErrorResponse(HttpStatus.FORBIDDEN, "Cross-origin action request denied");
  }

  const origin = req.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin === new URL(req.url).origin) return null;
  } catch {
    // Invalid and opaque origins are not same-origin with the request target.
  }

  return jsonErrorResponse(HttpStatus.FORBIDDEN, "Cross-origin action request denied");
}

async function loadGuardModule(
  loader: ActionGuardLoader,
): Promise<ActionGuardModule | null | Response> {
  try {
    return await loader();
  } catch (error) {
    if (isMissingActionGuardModule(error)) return null;
    logger.error("Action guard module failed to load", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
  }
}

function isMissingActionGuardModule(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const isMissingModule = candidate.code === "ERR_MODULE_NOT_FOUND" ||
    /^(?:Module not found|Cannot find module)\b/i.test(message);
  if (!isMissingModule) return false;

  const missingSpecifier = message.match(
    /^(?:Module not found|Cannot find module)\s+["']([^"']+)["']/i,
  )?.[1]?.replaceAll("\\", "/");

  return missingSpecifier === "#veryfront/rendering/rsc/server-action-guard.ts" ||
    missingSpecifier?.endsWith("/server-action-guard.ts") === true;
}

async function findActionFile(
  actionsRoot: string,
  id: string,
  adapter: ActionRequestParams["adapter"],
): Promise<string | null> {
  for (const extension of ["ts", "tsx", "js", "jsx"] as const) {
    const candidate = normalizePath(joinPath(actionsRoot, `${id}.${extension}`));
    if (!isWithinDirectory(actionsRoot, candidate)) continue;

    try {
      const stat = await adapter.fs.stat(candidate);
      if (stat.isFile) return candidate;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  return null;
}
