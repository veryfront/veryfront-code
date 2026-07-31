// Client-side hydrator for versioned RSC "use client" boundaries.

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
  readHydrationDataSnapshot,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";
import {
  decodeClientBoundaryChildren,
  materializeClientBoundaryChildren,
} from "./client-boundary-payload.ts";
import type { RSCNode } from "./types.ts";
import { wrapWithRouterProvider } from "./hydration-router.ts";
import {
  type HydrationManifest as ParsedHydrationManifest,
  parseHydrationManifest,
} from "./hydration-manifest.ts";
import { createClientRequestLifetime, readJsonResponseWithinLimit } from "./client-transport.ts";
import {
  recoverFromDependencySnapshotConflict,
  recoverFromSnapshotBoundModuleFailure,
} from "./dependency-snapshot-recovery.ts";
import {
  admitDependencySnapshot,
  type RecoverFromDependencySnapshotAdmissionFailure,
} from "./dependency-snapshot-admission.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "./constants.ts";

export type HydrationManifest = ParsedHydrationManifest & {
  readonly dependencyPinningCacheKey?: string;
};

interface ClientModule {
  default?: ReactTypes.ComponentType<unknown>;
  [exportName: string]: ReactTypes.ComponentType<unknown> | unknown;
}

interface ClientModuleImportOptions {
  importModule?: (moduleUrl: string) => Promise<ClientModule>;
  recoverSnapshotFailure?: (moduleUrl: string) => Promise<boolean>;
  releaseAssetModules?: ClientRuntimeHydrationData["releaseAssetModules"];
  clientPathByRel?: ReadonlyMap<string, string>;
}

interface ReactRoot {
  render(children: ReactTypes.ReactNode): void;
  unmount(): void;
}

interface GlobalHydrationState {
  __VF_CLIENT_MOD_CACHE?: Map<string, ClientModule>;
  __VF_CLIENT_ROOTS?: WeakMap<HTMLElement, ReactRoot>;
  __VF_MANIFEST_HASH?: string;
  __VF_TEST_MODE__?: boolean;
  __VF_HYDRATE_CALLED?: boolean;
}

declare const globalThis: typeof window & GlobalHydrationState;

const MAX_CLIENT_MOD_CACHE_SIZE = 100;
const MAX_CLIENT_REF_CHARACTERS = 65_536;
const MAX_CLIENT_BOUNDARY_PROPS_BYTES = 1024 * 1024;
const MAX_CLIENT_BOUNDARY_PROPS = 1_024;
const MAX_HYDRATION_MANIFEST_RESPONSE_BYTES = 8 * 1024 * 1024;
const propsEncoder = new TextEncoder();
const fallbackRootRegistry = new WeakMap<HTMLElement, ReactRoot>();

function getClientModCache(): Map<string, ClientModule> {
  const current = globalThis.__VF_CLIENT_MOD_CACHE;
  if (current instanceof Map) return current;

  const cache = new Map<string, ClientModule>();
  globalThis.__VF_CLIENT_MOD_CACHE = cache;
  return cache;
}

function setClientModCache(key: string, mod: ClientModule): void {
  const cache = getClientModCache();

  if (cache.size >= MAX_CLIENT_MOD_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  cache.set(key, mod);
}

function getClientRootRegistry(): WeakMap<HTMLElement, ReactRoot> {
  try {
    const current = globalThis.__VF_CLIENT_ROOTS;
    if (current instanceof WeakMap) return current;

    const roots = new WeakMap<HTMLElement, ReactRoot>();
    globalThis.__VF_CLIENT_ROOTS = roots;
    return roots;
  } catch {
    return fallbackRootRegistry;
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);
}

function isCanonicalLogicalClientPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    return false;
  }

  return value.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

function isCanonicalDirectModuleUrl(value: string): boolean {
  if (!value.startsWith("/_veryfront/") || value.startsWith("//")) return false;

  try {
    const url = new URL(value, "https://veryfront.invalid");
    return url.origin === "https://veryfront.invalid" &&
      url.pathname.startsWith("/_veryfront/");
  } catch {
    return false;
  }
}

export interface ParsedClientRef {
  rel?: string;
  moduleUrl?: string;
  exportName: string;
}

export function parseClientRef(ref: string): ParsedClientRef | null {
  if (
    typeof ref !== "string" ||
    ref.length === 0 ||
    ref.length > MAX_CLIENT_REF_CHARACTERS ||
    hasControlCharacters(ref)
  ) {
    return null;
  }

  // Export names may include $, -, and . in addition to alphanumeric + underscore.
  // Path portion allows any characters up to the last #.
  const m = ref.match(/^\/app\/(.+)#([\w$.-]+)$/);
  if (m && isCanonicalLogicalClientPath(m[1]!)) {
    return { rel: `/${m[1]}`, exportName: m[2]! };
  }

  const direct = ref.match(/^(\/_veryfront\/[^#]+)#([\w$.-]+)$/);
  if (direct && isCanonicalDirectModuleUrl(direct[1]!)) {
    return { moduleUrl: direct[1], exportName: direct[2]! };
  }

  rscLogger.debug("hydrate: unrecognised client ref format, skipping", { ref });
  return null;
}

export function readClientBoundaryProps(
  el: HTMLElement,
): Record<string, unknown> | null {
  const serialized = el.dataset?.rscProps;
  if (!serialized) return {};

  try {
    if (
      serialized.length > MAX_CLIENT_BOUNDARY_PROPS_BYTES ||
      propsEncoder.encode(serialized).byteLength > MAX_CLIENT_BOUNDARY_PROPS_BYTES
    ) {
      throw new RangeError("Client boundary props byte limit was exceeded");
    }
    const props = JSON.parse(serialized) as unknown;
    if (!props || typeof props !== "object" || Array.isArray(props)) return null;

    const entries = Object.entries(props);
    if (entries.length > MAX_CLIENT_BOUNDARY_PROPS) {
      throw new RangeError("Client boundary prop limit was exceeded");
    }

    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return snapshot;
  } catch (error) {
    rscLogger.debug("hydrate: invalid client boundary props, rejecting boundary", error);
    return null;
  }
}

export function readClientBoundaryChildren(el: HTMLElement): RSCNode[] {
  const serialized = el.dataset?.rscChildren;
  return serialized ? decodeClientBoundaryChildren(serialized) : [];
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

export interface HydrationManifestDependencySnapshotOptions {
  readonly requestedDependencyPinningCacheKey?: string;
  readonly currentDependencyPinningCacheKey?: unknown;
  readonly responseHeaderDependencyPinningCacheKey: string | null;
  readonly recoverFromAdmissionFailure?: RecoverFromDependencySnapshotAdmissionFailure;
}

function readManifestDependencyPinningCacheKey(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) return undefined;

  const descriptor = Object.getOwnPropertyDescriptor(
    value,
    "dependencyPinningCacheKey",
  );
  if (!descriptor) return undefined;
  return Object.hasOwn(descriptor, "value") ? descriptor.value : descriptor;
}

export function admitSnapshotBoundHydrationManifest(
  value: unknown,
  options: HydrationManifestDependencySnapshotOptions,
): HydrationManifest | null {
  const manifest = parseHydrationManifest(value);
  if (!manifest) return null;

  const admission = admitDependencySnapshot(
    {
      requestedDependencyPinningCacheKey: options.requestedDependencyPinningCacheKey,
      currentDependencyPinningCacheKey: options.currentDependencyPinningCacheKey,
      responseHeaderDependencyPinningCacheKey: options.responseHeaderDependencyPinningCacheKey,
      responseBodyDependencyPinningCacheKey: readManifestDependencyPinningCacheKey(value),
      requireResponseHeader: true,
      requireResponseBody: true,
    },
    options.recoverFromAdmissionFailure,
  );
  if (!admission) return null;
  if (admission.dependencyPinningCacheKey === "off") return manifest;

  return Object.freeze({
    ...manifest,
    dependencyPinningCacheKey: admission.dependencyPinningCacheKey,
  });
}

async function fetchManifest(
  doc: Document = document,
): Promise<HydrationManifest | null> {
  const lifetime = createClientRequestLifetime();
  try {
    const requestedHydrationSnapshot = readHydrationDataSnapshot(doc);
    if (!requestedHydrationSnapshot.valid) {
      admitDependencySnapshot({
        requestedDependencyPinningCacheKey: requestedHydrationSnapshot,
        currentDependencyPinningCacheKey: requestedHydrationSnapshot,
      });
      return null;
    }
    const hydrationData = requestedHydrationSnapshot.data;
    const res = await fetch(buildHydrationManifestUrl(hydrationData), {
      headers: {
        Accept: "application/json",
        ...buildHydrationManifestHeaders(hydrationData),
      },
      signal: lifetime.signal,
    });
    if (!res.ok) {
      await recoverFromDependencySnapshotConflict(res);
      try {
        await res.body?.cancel();
      } catch {
        // The request lifetime may already have cancelled the body.
      }
      return null;
    }
    const value = await readJsonResponseWithinLimit(
      res,
      MAX_HYDRATION_MANIFEST_RESPONSE_BYTES,
    );
    const currentHydrationSnapshot = readHydrationDataSnapshot(doc);
    return admitSnapshotBoundHydrationManifest(value, {
      requestedDependencyPinningCacheKey: hydrationData?.dependencyPinningCacheKey,
      currentDependencyPinningCacheKey: currentHydrationSnapshot.valid
        ? currentHydrationSnapshot.data?.dependencyPinningCacheKey
        : currentHydrationSnapshot,
      responseHeaderDependencyPinningCacheKey: res.headers.get(
        RSC_DEPENDENCY_PINNING_HEADER,
      ),
    });
  } catch (_) {
    /* expected: manifest fetch may fail when RSC is not configured */
    return null;
  } finally {
    lifetime.dispose();
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
    options.clientPathByRel,
  );
  if (!moduleUrl) return null;
  const cacheKey = `${moduleUrl}#${manifest.hash ?? ""}`;

  try {
    const cached = getClientModCache().get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    rscLogger.debug("hydrate: cache get failed", e);
  }

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
  clientPathByRel?: ReadonlyMap<string, string>,
): string | null {
  if (reference.moduleUrl) {
    return appendClientModuleDependencyPins(
      reference.moduleUrl,
      manifest.dependencyPinningCacheKey,
    );
  }
  if (!reference.rel) return null;

  const absPath = clientPathByRel?.get(reference.rel) ??
    manifest.graphIds?.client.find((entry) => entry.rel === reference.rel)?.path;
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

export function shouldHydrateClientBoundary(
  element: HTMLElement,
  manifestIdentity: string,
): boolean {
  return element.dataset?.hydrated !== "true" ||
    element.dataset?.hydrationHash !== manifestIdentity;
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
  const manifestIdentity = manifest.hash ?? `version-${manifest.version}`;
  const nodesToHydrate = nodes.filter((element) =>
    shouldHydrateClientBoundary(element, manifestIdentity)
  );

  if (nodesToHydrate.length === 0) {
    try {
      globalThis.__VF_MANIFEST_HASH = manifest.hash ?? "";
    } catch (e) {
      rscLogger.debug("hydrate: set hash failed", e);
    }
    return;
  }

  const currentHydrationSnapshot = readHydrationDataSnapshot(doc);
  const manifestSnapshotAdmission = admitDependencySnapshot({
    requestedDependencyPinningCacheKey: manifest.dependencyPinningCacheKey,
    currentDependencyPinningCacheKey: currentHydrationSnapshot.valid
      ? currentHydrationSnapshot.data?.dependencyPinningCacheKey
      : currentHydrationSnapshot,
  });
  if (!manifestSnapshotAdmission) return;

  const hydrationData = currentHydrationSnapshot.data;
  const clientModuleStrategy = resolveClientModuleStrategy(hydrationData);
  const releaseAssetModules = hydrationData?.releaseAssetModules;
  const moduleById = new Map(
    manifest.modules.map((entry) => [entry.id, entry] as const),
  );
  const clientPathByRel = new Map(
    (manifest.graphIds?.client ?? []).map((entry) => [entry.rel, entry.path] as const),
  );

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

  const rootRegistry = getClientRootRegistry();
  for (const el of nodesToHydrate) {
    const ref = el.dataset?.clientRef ?? "";
    if (!ref) continue;

    const parsed = parseClientRef(ref);
    if (!parsed) continue;

    const mod = await importClientModule(
      manifest,
      parsed,
      clientModuleStrategy,
      { releaseAssetModules, clientPathByRel },
    );
    if (!mod) continue;

    const Cmp = mod[parsed.exportName] ?? mod.default;
    if (typeof Cmp !== "function") continue;

    try {
      const existingRoot = rootRegistry.get(el);
      const root: ReactRoot = existingRoot ?? createRoot(el);
      if (!existingRoot) {
        rootRegistry.set(el, root);
      }
      const props = readClientBoundaryProps(el);
      if (!props) {
        throw new TypeError("Client boundary props failed admission");
      }
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
          const moduleEntry = moduleById.get(componentId);
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
            { releaseAssetModules, clientPathByRel },
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
      el.dataset.hydrationHash = manifestIdentity;
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
