// Experimental client-side hydrator for RSC "use client" boundaries
// Minimal: hydrate default export without props in dev

import { rscLogger } from "../client/browser-logger.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import type * as ReactTypes from "react";
import {
  appendClientModuleDependencyPins,
  buildClientModuleUrl,
  buildRSCTransportHeaders,
  type ClientModuleStrategy,
  type ClientRuntimeHydrationData,
  getHydrationReactImportSpecifiers,
  readHydrationData,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";
import {
  materializeClientBoundaryChildren,
  parseClientBoundaryChildren,
} from "./client-boundary-payload.ts";
import type { RSCNode } from "./types.ts";
import { wrapWithRouterProvider } from "./hydration-router.ts";
import {
  recoverFromDependencySnapshotConflict,
  recoverFromSnapshotBoundModuleFailure,
} from "./dependency-snapshot-recovery.ts";
export type HydrationManifest = {
  version: number;
  hash?: string;
  dependencyPinningCacheKey?: string;
  components?: Record<string, string>;
  modules: { id: string; clientRef: string; exports: string[] }[];
  graphIds?: {
    client: { id: string; path: string; rel: string }[];
    server: { id: string; path: string; rel: string }[];
  };
};

interface ClientModule {
  default?: ReactTypes.ComponentType<unknown>;
  [exportName: string]: ReactTypes.ComponentType<unknown> | unknown;
}

interface ClientModuleImportOptions {
  importModule?: (moduleUrl: string) => Promise<ClientModule>;
  recoverSnapshotFailure?: (moduleUrl: string) => Promise<boolean>;
  releaseAssetModules?: ClientRuntimeHydrationData["releaseAssetModules"];
}

interface ReactRoot {
  render(children: ReactTypes.ReactNode): void;
  unmount(): void;
}

declare global {
  interface Window {
    __VF_CLIENT_MOD_CACHE?: Map<string, ClientModule>;
    __VF_MANIFEST_HASH?: string;
    __VF_TEST_MODE__?: boolean;
    __VF_HYDRATE_CALLED?: boolean;
  }

  var __VF_CLIENT_MOD_CACHE: Map<string, ClientModule> | undefined;
  var __VF_MANIFEST_HASH: string | undefined;
  var __VF_TEST_MODE__: boolean | undefined;
  var __VF_HYDRATE_CALLED: boolean | undefined;
}

const MAX_CLIENT_MOD_CACHE_SIZE = 100;

function setClientModCache(key: string, mod: ClientModule): void {
  globalThis.__VF_CLIENT_MOD_CACHE ??= new Map();

  if (globalThis.__VF_CLIENT_MOD_CACHE.size >= MAX_CLIENT_MOD_CACHE_SIZE) {
    const oldest = globalThis.__VF_CLIENT_MOD_CACHE.keys().next().value;
    if (oldest) globalThis.__VF_CLIENT_MOD_CACHE.delete(oldest);
  }

  globalThis.__VF_CLIENT_MOD_CACHE.set(key, mod);
}

export interface ParsedClientRef {
  rel?: string;
  moduleUrl?: string;
  exportName: string;
}

export function parseClientRef(ref: string): ParsedClientRef | null {
  // Export names may include $, -, and . in addition to alphanumeric + underscore.
  // Path portion allows any characters up to the last #.
  const m = ref.match(/^\/app\/(.+)#([\w$.-]+)$/);
  if (m) {
    return { rel: `/${m[1] || ""}`, exportName: m[2] || "default" };
  }

  const direct = ref.match(/^(\/_veryfront\/[^#]+)#([\w$.-]+)$/);
  if (direct) {
    return { moduleUrl: direct[1], exportName: direct[2] || "default" };
  }

  rscLogger.debug("hydrate: unrecognised client ref format, skipping", { ref });
  return null;
}

export function readClientBoundaryProps(el: HTMLElement): Record<string, unknown> {
  const serialized = el.dataset?.rscProps;
  if (!serialized) return {};

  try {
    const props = JSON.parse(serialized) as unknown;
    return props && typeof props === "object" && !Array.isArray(props)
      ? props as Record<string, unknown>
      : {};
  } catch (error) {
    rscLogger.debug("hydrate: invalid client boundary props, using empty props", error);
    return {};
  }
}

export function readClientBoundaryChildren(el: HTMLElement): RSCNode[] {
  return parseClientBoundaryChildren(el.dataset?.rscChildren);
}

export const base64url = base64urlEncode;

export function buildHydrationManifestUrl(
  _hydrationData: ReturnType<typeof readHydrationData>,
): string {
  return "/_veryfront/rsc/manifest";
}

export function buildHydrationManifestHeaders(
  hydrationData: ReturnType<typeof readHydrationData>,
): Record<string, string> {
  return buildRSCTransportHeaders(hydrationData);
}

async function fetchManifest(doc: Document = document): Promise<HydrationManifest | null> {
  try {
    const hydrationData = readHydrationData(doc);
    const res = await fetch(buildHydrationManifestUrl(hydrationData), {
      headers: buildHydrationManifestHeaders(hydrationData),
    });
    if (!res.ok) {
      await recoverFromDependencySnapshotConflict(res);
      return null;
    }
    return (await res.json()) as HydrationManifest;
  } catch (_) {
    /* expected: manifest fetch may fail when RSC is not configured */
    return null;
  }
}

export async function importClientModule(
  manifest: HydrationManifest,
  reference: ParsedClientRef,
  strategy: ClientModuleStrategy,
  options: ClientModuleImportOptions = {},
): Promise<ClientModule | null> {
  const moduleUrl = resolveClientBoundaryModuleUrl(
    manifest,
    reference,
    strategy,
    options.releaseAssetModules,
  );
  const cacheIdentity = reference.moduleUrl ?? reference.rel;
  if (!cacheIdentity) return null;
  const cacheKey = `${cacheIdentity}#${manifest.hash ?? ""}`;

  try {
    const cached = globalThis.__VF_CLIENT_MOD_CACHE?.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    rscLogger.debug("hydrate: cache get failed", e);
  }

  if (!moduleUrl) return null;

  try {
    const mod = await (options.importModule ?? ((url) => import(url) as Promise<ClientModule>))(
      moduleUrl,
    );

    try {
      setClientModCache(cacheKey, mod);
    } catch (e) {
      rscLogger.debug("hydrate: cache set failed", e);
    }

    return mod;
  } catch (e) {
    rscLogger.debug("hydrate: failed to import module", { moduleUrl, error: e });
    await (options.recoverSnapshotFailure ?? recoverFromSnapshotBoundModuleFailure)(moduleUrl);
    return null;
  }
}

export function resolveClientBoundaryModuleUrl(
  manifest: HydrationManifest,
  reference: ParsedClientRef,
  strategy: ClientModuleStrategy,
  releaseAssetModules?: ClientRuntimeHydrationData["releaseAssetModules"],
): string | null {
  if (reference.moduleUrl) {
    return appendClientModuleDependencyPins(
      reference.moduleUrl,
      manifest.dependencyPinningCacheKey,
    );
  }
  if (!reference.rel) return null;

  const absPath = manifest.graphIds?.client.find((entry) => entry.rel === reference.rel)?.path;
  return buildClientModuleUrl({
    strategy,
    rel: reference.rel,
    absPath,
    version: manifest.hash,
    dependencyPinningCacheKey: manifest.dependencyPinningCacheKey,
    releaseAssetModules,
  });
}

export function selectTopLevelClientBoundaries(doc: Document): HTMLElement[] {
  const boundaries = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-client-ref]"),
  );
  const boundarySet = new Set<HTMLElement>(boundaries);

  return boundaries.filter((boundary) => {
    let ancestor = boundary.parentElement;
    while (ancestor) {
      if (boundarySet.has(ancestor)) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

export async function hydrateAllClientBoundaries(doc: Document = document): Promise<void> {
  let manifest: HydrationManifest | null = null;

  try {
    manifest = await fetchManifest(doc);
  } catch (e) {
    rscLogger.debug("hydrate: fetch manifest failed", e);
  }

  if (!manifest) {
    rscLogger.debug("hydrate: no manifest");
    return;
  }

  const nodes = selectTopLevelClientBoundaries(doc);

  try {
    const lastHash = globalThis.__VF_MANIFEST_HASH;
    const needsHydrate = nodes.some((el) => el.dataset?.hydrated !== "true");
    if (!needsHydrate && lastHash && manifest.hash && lastHash === manifest.hash) return;
  } catch (e) {
    rscLogger.debug("hydrate: hmr hash read failed", e);
  }

  if (nodes.length === 0) {
    try {
      globalThis.__VF_MANIFEST_HASH = manifest.hash ?? "";
    } catch (e) {
      rscLogger.debug("hydrate: set hash failed", e);
    }
    return;
  }

  const hydrationData = readHydrationData(doc);
  const clientModuleStrategy = resolveClientModuleStrategy(hydrationData);
  const releaseAssetModules = hydrationData?.releaseAssetModules;

  try {
    if (globalThis.__VF_TEST_MODE__) {
      globalThis.__VF_HYDRATE_CALLED = true;
      globalThis.__VF_MANIFEST_HASH = manifest.hash ?? "";
      return;
    }
  } catch (e) {
    rscLogger.debug("hydrate: test mode flags failed", e);
  }

  const reactSpecifiers = getHydrationReactImportSpecifiers(
    doc,
    hydrationData?.reactVersion,
  );
  const [{ default: React }, { createRoot }] = await Promise.all([
    import(reactSpecifiers.react),
    import(reactSpecifiers.reactDomClient),
  ]);

  for (const el of nodes) {
    const ref = el.dataset?.clientRef ?? "";
    if (!ref || el.dataset?.hydrated === "true") continue;

    const parsed = parseClientRef(ref);
    if (!parsed) continue;

    const mod = await importClientModule(
      manifest,
      parsed,
      clientModuleStrategy,
      { releaseAssetModules },
    );
    if (!mod) continue;

    const Cmp = mod[parsed.exportName] ?? mod.default;
    if (typeof Cmp !== "function") continue;

    try {
      const root: ReactRoot = createRoot(el);
      const props = readClientBoundaryProps(el);
      const childNodes = readClientBoundaryChildren(el);
      const children = await materializeClientBoundaryChildren(
        childNodes,
        {
          Fragment: React.Fragment,
          createElement(type, elementProps, ...elementChildren) {
            return React.createElement(
              type as ReactTypes.ElementType,
              elementProps,
              ...elementChildren as ReactTypes.ReactNode[],
            );
          },
        },
        async (componentId) => {
          const moduleEntry = manifest.modules.find((entry) => entry.id === componentId);
          const componentUrl = manifest.components?.[componentId];
          const clientRef = moduleEntry?.clientRef ??
            (componentUrl ? `${componentUrl}#default` : undefined);
          if (!clientRef) return null;

          const childReference = parseClientRef(clientRef);
          if (!childReference) return null;
          const childModule = await importClientModule(
            manifest,
            childReference,
            clientModuleStrategy,
            { releaseAssetModules },
          );
          if (!childModule) return null;
          const Child = childModule[childReference.exportName] ?? childModule.default;
          return typeof Child === "function" ? Child : null;
        },
      );
      const tree = await wrapWithRouterProvider(
        React.createElement(
          Cmp as ReactTypes.FC<Record<string, unknown>>,
          props,
          ...children as ReactTypes.ReactNode[],
        ),
        hydrationData,
        doc,
      );
      root.render(tree);
      el.dataset.hydrated = "true";
    } catch (e) {
      rscLogger.warn("hydrate: render failed", e);
    }
  }

  try {
    globalThis.__VF_MANIFEST_HASH = manifest.hash ?? "";
  } catch (e) {
    rscLogger.debug("hydrate: set hash failed (post)", e);
  }
}

export async function bootHydration(): Promise<void> {
  try {
    await hydrateAllClientBoundaries(document);
  } catch (e) {
    rscLogger.warn("hydrate: boot failed", e);
  }
}
