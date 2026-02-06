import { AsyncLocalStorage } from "node:async_hooks";
import type { HandlerContext } from "../types/server.ts";
import { type CacheKeyContext, CacheKeyContextSchema } from "./schemas/index.ts";
import { buildContentHashCacheKey } from "./keys.ts";

type MultiProjectRequestContextType = {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
};

let _getCurrentRequestContext: (() => MultiProjectRequestContextType | null) | null | undefined;

export type { CacheKeyContext };

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext>();

function validateCacheKeyContext(ctx: CacheKeyContext): CacheKeyContext {
  return CacheKeyContextSchema.parse(ctx);
}

export function getContentHashKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  return buildContentHashCacheKey(prefix, filePath, contentHash, suffix);
}

export function runWithCacheKeyContext<T>(ctx: CacheKeyContext, fn: () => T): T {
  return cacheKeyContextStorage.run(validateCacheKeyContext(ctx), fn);
}

export function getCurrentCacheKeyContext(): CacheKeyContext {
  const ctx = cacheKeyContextStorage.getStore();
  if (ctx) return ctx;

  throw new Error(
    "[CacheKeyBuilder] No cache context available. " +
      "Ensure runWithCacheKeyContext() was called at request entry.",
  );
}

function getRequestContextFn(): (() => MultiProjectRequestContextType | null) | null {
  if (_getCurrentRequestContext !== undefined) return _getCurrentRequestContext;

  try {
    // deno-lint-ignore no-explicit-any
    const mod = (globalThis as any).__vf_multi_project_adapter;
    _getCurrentRequestContext = mod?.getCurrentRequestContext ?? null;
  } catch {
    _getCurrentRequestContext = null;
  }

  return _getCurrentRequestContext ?? null;
}

function extractCacheKeyContextFromMultiProjectContext(
  reqCtx: MultiProjectRequestContextType,
): CacheKeyContext {
  const projectId = reqCtx.projectId || reqCtx.projectSlug || "default";
  const mode: CacheKeyContext["mode"] = reqCtx.productionMode ? "production" : "preview";

  let versionId: string;
  if (reqCtx.productionMode) {
    versionId = reqCtx.releaseId || "latest";
  } else {
    versionId = reqCtx.branch || "main";
  }

  return { projectId, mode, versionId };
}

export function tryGetCacheKeyContext(): CacheKeyContext | null {
  const explicitCtx = cacheKeyContextStorage.getStore();
  if (explicitCtx) return explicitCtx;

  const reqCtx = getRequestContextFn()?.();
  if (!reqCtx) return null;

  return extractCacheKeyContextFromMultiProjectContext(reqCtx);
}

function buildProjectScopedKey(prefix: string, resourceKey: string, ctx: CacheKeyContext): string {
  return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}

export function getProjectScopedKey(prefix: string, resourceKey: string): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx || ctx.mode === "preview") return null;

  return buildProjectScopedKey(prefix, resourceKey, ctx);
}

export function getProjectScopedKeyAlways(prefix: string, resourceKey: string): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx) return null;

  return buildProjectScopedKey(prefix, resourceKey, ctx);
}

export function extractCacheKeyContext(handlerCtx: HandlerContext): CacheKeyContext {
  const projectId = handlerCtx.projectId || handlerCtx.projectSlug || "default";
  const mode = handlerCtx.resolvedEnvironment ?? handlerCtx.requestContext?.mode ?? "preview";

  let versionId: string;
  if (mode === "production") {
    versionId = handlerCtx.releaseId || "latest";
  } else {
    versionId = handlerCtx.parsedDomain?.branch || "main";
  }

  return { projectId, mode, versionId };
}

export type { MultiProjectRequestContextType as MultiProjectRequestContext };
