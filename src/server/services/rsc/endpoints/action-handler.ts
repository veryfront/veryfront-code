/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { serverLogger } from "#veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("rsc");

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
  const body = await req.json().catch((error) => {
    logger.warn("Failed to parse action request body", { error });
    return {};
  });

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
      logger.error("Action guard execution failed", { error });
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

async function loadGuardModule(
  loader: ActionGuardLoader,
): Promise<ActionGuardModule | null | Response> {
  try {
    return await loader();
  } catch (error) {
    if (isMissingActionGuardModule(error)) return null;
    logger.error("Action guard module failed to load", { error });
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
