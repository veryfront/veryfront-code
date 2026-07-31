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
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveProjectReactVersion,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { preloadImportMap } from "#veryfront/modules/import-map/index.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

const logger = serverLogger.component("rsc");

interface ActionGuardModule {
  rscActionGuard?: (
    req: Request,
    context: { id: string; args: unknown[] },
  ) => boolean | Promise<boolean>;
}

export type ActionGuardLoader = () => Promise<ActionGuardModule>;
export type ActionModuleLoader = typeof loadModuleFromSource;

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
  params: ActionRequestParams,
  actionGuardLoader: ActionGuardLoader,
  actionModuleLoader: ActionModuleLoader = loadModuleFromSource,
): Promise<Response> {
  return withDependencyPinningVary(
    await handleActionRequestWithGuardLoaderInner(
      params,
      actionGuardLoader,
      actionModuleLoader,
    ),
  );
}

async function handleActionRequestWithGuardLoaderInner(
  {
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
  }: ActionRequestParams,
  actionGuardLoader: ActionGuardLoader,
  actionModuleLoader: ActionModuleLoader = loadModuleFromSource,
): Promise<Response> {
  const dependencySource = dependencyPinningSource ??
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
  const dependencySnapshot = await resolveActionDependencySnapshot(
    req,
    dependencySource,
  );
  if (dependencySnapshot instanceof Response) return dependencySnapshot;

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(req, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return jsonErrorResponse(HTTP_PAYLOAD_TOO_LARGE, "Request body too large");
    }
    logger.warn("Failed to parse action request body", { error });
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid JSON body");
  }

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof Response) return parseResult;

  const { id, args } = parseResult;

  const guardModule = await loadGuardModule(actionGuardLoader);
  if (guardModule instanceof Response) return guardModule;

  const guard = guardModule.rscActionGuard;
  if (typeof guard !== "function") {
    logger.error("Action guard export is not a function");
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
  }

  try {
    const ok = await guard(req, { id, args });
    if (!ok) return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
  } catch (error) {
    logger.error("Action guard execution failed", { error });
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
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
  const resolvedContentSourceId = contentSourceId ??
    releaseId ??
    (branch ? `branch:${branch}` : undefined) ??
    (mode === "development" ? "preview-main" : "production");
  const [reactVersion, importMap] = await Promise.all([
    resolveProjectReactVersion({
      projectDir,
      dependencyPinningSource: dependencySource,
      config,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
    }),
    preloadImportMap(projectDir, adapter, projectId, {
      contentSourceId: resolvedContentSourceId,
      config,
    }),
  ]);
  const mod = await actionModuleLoader(source, file, projectDir, adapter, {
    projectId: projectId ?? projectDir,
    projectSlug,
    contentSourceId: resolvedContentSourceId,
    dev: mode === "development",
    mode: mode === "development" ? "preview" : "production",
    reactVersion,
    importMap,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
    dependencyPinningSource: dependencySource,
    moduleServerOrigin: dependencySnapshot.cacheKey.startsWith("on:")
      ? new URL(req.url).origin
      : undefined,
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

async function resolveActionDependencySnapshot(
  req: Request,
  dependencyPinningSource: DependencyPinningSourceInput,
): Promise<DependencyPinningSnapshot | Response> {
  const requestedPinKey = req.headers.get(RSC_DEPENDENCY_PINNING_HEADER);
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
  return snapshot;
}

function withDependencyPinningVary(response: Response): Response {
  appendVaryHeader(response.headers, RSC_DEPENDENCY_PINNING_HEADER);
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

function unknownDependencySnapshotResponse(): Response {
  return new Response("Unknown dependency snapshot", {
    status: HttpStatus.CONFLICT,
    headers: { "cache-control": "no-store" },
  });
}

async function loadGuardModule(
  loader: ActionGuardLoader,
): Promise<ActionGuardModule | Response> {
  try {
    return await loader();
  } catch (error) {
    logger.error("Action guard module failed to load", { error });
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "action guard failed");
  }
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
