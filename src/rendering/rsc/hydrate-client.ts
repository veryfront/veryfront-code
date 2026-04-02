// Experimental client-side hydrator for RSC "use client" boundaries
// Minimal: hydrate default export without props in dev

import { rscLogger } from "../client/browser-logger.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import {
  buildClientModuleUrl,
  type ClientModuleStrategy,
  getHydrationReactImportSpecifiers,
  readHydrationData,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";
import type { Root } from "https://esm.sh/react-dom@18.3.1/client";

type Manifest = {
  version: number;
  hash?: string;
  modules: { id: string; clientRef: string; exports: string[] }[];
  graphIds?: {
    client: { id: string; path: string; rel: string }[];
    server: { id: string; path: string; rel: string }[];
  };
};

interface ClientModule {
  default?: React.ComponentType<unknown>;
  [exportName: string]: React.ComponentType<unknown> | unknown;
}

interface VeryfrontHydrate {
  run: () => Promise<void>;
}

interface GlobalHydrationState {
  __VF_CLIENT_MOD_CACHE?: Map<string, ClientModule>;
  __VF_MANIFEST_HASH?: string;
  __VF_TEST_MODE__?: boolean;
  __VF_HYDRATE_CALLED?: boolean;
  VeryfrontHydrate?: VeryfrontHydrate;
}

declare const globalThis: typeof window & GlobalHydrationState;

const MAX_CLIENT_MOD_CACHE_SIZE = 100;

function setClientModCache(key: string, mod: ClientModule): void {
  globalThis.__VF_CLIENT_MOD_CACHE ??= new Map();

  if (globalThis.__VF_CLIENT_MOD_CACHE.size >= MAX_CLIENT_MOD_CACHE_SIZE) {
    const oldest = globalThis.__VF_CLIENT_MOD_CACHE.keys().next().value;
    if (oldest) globalThis.__VF_CLIENT_MOD_CACHE.delete(oldest);
  }

  globalThis.__VF_CLIENT_MOD_CACHE.set(key, mod);
}

function parseClientRef(ref: string): { rel: string; exportName: string } | null {
  const m = ref.match(/^\/app\/(.+)#([A-Za-z0-9_]+)$/);
  if (!m) return null;
  return { rel: `/${m[1] || ""}`, exportName: m[2] || "default" };
}

export const base64url = base64urlEncode;

async function fetchManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch("/_veryfront/rsc/manifest");
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  } catch (_) {
    /* expected: manifest fetch may fail when RSC is not configured */
    return null;
  }
}

async function importClientModule(
  manifest: Manifest,
  rel: string,
  strategy: ClientModuleStrategy,
): Promise<ClientModule | null> {
  const abs = manifest.graphIds?.client.find((e) => e.rel === rel)?.path;
  const cacheKey = `${rel}#${manifest.hash ?? ""}`;

  try {
    const cached = globalThis.__VF_CLIENT_MOD_CACHE?.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    rscLogger.debug("hydrate: cache get failed", e);
  }

  const moduleUrl = buildClientModuleUrl({
    strategy,
    rel,
    absPath: abs,
    version: manifest.hash,
  });
  if (!moduleUrl) return null;

  try {
    const mod = (await import(moduleUrl)) as ClientModule;

    try {
      setClientModCache(cacheKey, mod);
    } catch (e) {
      rscLogger.debug("hydrate: cache set failed", e);
    }

    return mod;
  } catch (e) {
    rscLogger.debug("hydrate: failed to import module", { moduleUrl, error: e });
    return null;
  }
}

export async function hydrateAllClientBoundaries(doc: Document = document): Promise<void> {
  let manifest: Manifest | null = null;

  try {
    manifest = await fetchManifest();
  } catch (e) {
    rscLogger.debug("hydrate: fetch manifest failed", e);
  }

  if (!manifest) {
    rscLogger.debug("hydrate: no manifest");
    return;
  }

  const nodes = Array.from(doc.querySelectorAll<HTMLElement>("[data-client-ref]"));

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

  const clientModuleStrategy = resolveClientModuleStrategy(readHydrationData(doc));

  try {
    if (globalThis.__VF_TEST_MODE__) {
      globalThis.__VF_HYDRATE_CALLED = true;
      globalThis.__VF_MANIFEST_HASH = manifest.hash ?? "";
      return;
    }
  } catch (e) {
    rscLogger.debug("hydrate: test mode flags failed", e);
  }

  const reactSpecifiers = getHydrationReactImportSpecifiers(doc);
  const [{ default: React }, { createRoot }] = await Promise.all([
    import(reactSpecifiers.react),
    import(reactSpecifiers.reactDomClient),
  ]);

  for (const el of nodes) {
    const ref = el.dataset?.clientRef ?? "";
    if (!ref || el.dataset?.hydrated === "true") continue;

    const parsed = parseClientRef(ref);
    if (!parsed) continue;

    const mod = await importClientModule(manifest, parsed.rel, clientModuleStrategy);
    if (!mod) continue;

    const Cmp = mod[parsed.exportName] ?? mod.default;
    if (typeof Cmp !== "function") continue;

    try {
      const root: Root = createRoot(el);
      root.render(React.createElement(Cmp as React.FC, {}));
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

try {
  globalThis.VeryfrontHydrate = { run: () => bootHydration() };
} catch (e) {
  rscLogger.debug("hydrate: expose run failed", e);
}
