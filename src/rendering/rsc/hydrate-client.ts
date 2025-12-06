// Experimental client-side hydrator for RSC "use client" boundaries
// Minimal: hydrate default export without props in dev

import { rscLogger } from "../client/browser-logger.ts";
import {
  getReactCDNUrl,
  getReactDOMClientCDNUrl,
} from "../../core/utils/constants/cdn.ts";
// Note: Using centralized version from cdn.ts
import type { Root } from "https://esm.sh/react-dom@18.3.1/client";

// React CDN URLs - derived from centralized constants
const REACT_URL = getReactCDNUrl();
const REACT_DOM_CLIENT_URL = getReactDOMClientCDNUrl();

type Manifest = {
  version: number;
  hash?: string;
  modules: { id: string; clientRef: string; exports: string[] }[];
  graphIds?: {
    client: { id: string; path: string; rel: string }[];
    server: { id: string; path: string; rel: string }[];
  };
};

// ClientModule represents a dynamically imported client component module
interface ClientModule {
  default?: React.ComponentType<unknown>;
  [exportName: string]: React.ComponentType<unknown> | unknown;
}

// GlobalHydrationState extends globalThis with Veryfront-specific properties
interface GlobalHydrationState {
  __VF_CLIENT_MOD_CACHE?: Map<string, ClientModule>;
  __VF_MANIFEST_HASH?: string;
  __VF_TEST_MODE__?: boolean;
  __VF_HYDRATE_CALLED?: boolean;
  VeryfrontHydrate?: VeryfrontHydrate;
}

// VeryfrontHydrate exposes the public hydration API
interface VeryfrontHydrate {
  run: () => Promise<void>;
}

declare const globalThis: typeof window & GlobalHydrationState;

export function parseClientRef(ref: string): { rel: string; exportName: string } | null {
  const m = ref.match(/^\/app\/(.+)#([A-Za-z0-9_]+)$/);
  if (!m) return null;
  return { rel: `/${m[1] || ""}`, exportName: m[2] || "default" };
}

export function base64url(input: string): string {
  const b64 = btoa(input);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function fetchManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch("/_veryfront/rsc/manifest");
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  } catch (_e) {
    return null;
  }
}

function resolveImportUrlDev(absPath: string): string {
  return `/_veryfront/fs/${base64url(absPath)}.js`;
}

async function importClientModule(manifest: Manifest, rel: string): Promise<ClientModule | null> {
  const abs = manifest.graphIds?.client.find((e) => e.rel === rel)?.path;
  if (!abs) return null;
  const devUrl = resolveImportUrlDev(abs);
  const cacheKey = `${rel}#${manifest.hash || ""}`;
  try {
    const cached = globalThis.__VF_CLIENT_MOD_CACHE?.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    rscLogger.debug("hydrate: cache get failed", e);
  }
  try {
    const mod = await import(devUrl) as ClientModule;
    try {
      globalThis.__VF_CLIENT_MOD_CACHE = globalThis.__VF_CLIENT_MOD_CACHE || new Map();
      globalThis.__VF_CLIENT_MOD_CACHE.set(cacheKey, mod);
    } catch (e) {
      rscLogger.debug("hydrate: cache set failed", e);
    }
    return mod;
  } catch (e) {
    rscLogger.debug("hydrate: failed to import dev url", { devUrl, error: e });
    // Prod fallback: serve by rel path under /_veryfront/rsc/module?rel=/comp/widget.tsx
    try {
      const v = manifest.hash ? `&v=${encodeURIComponent(manifest.hash)}` : "";
      const url = `/_veryfront/rsc/module?rel=${encodeURIComponent(rel)}${v}`;
      const mod = await import(url) as ClientModule;
      try {
        globalThis.__VF_CLIENT_MOD_CACHE = globalThis.__VF_CLIENT_MOD_CACHE || new Map();
        globalThis.__VF_CLIENT_MOD_CACHE.set(cacheKey, mod);
      } catch (e) {
        rscLogger.debug("hydrate: cache set failed (prod)", e);
      }
      return mod;
    } catch (e2) {
      rscLogger.debug("hydrate: failed to import prod url", { rel, error: e2 });
      return null;
    }
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

  const nodes = Array.from(doc.querySelectorAll("[data-client-ref]")) as HTMLElement[];
  // If nothing to hydrate and manifest hash unchanged, skip work
  try {
    const lastHash = globalThis.__VF_MANIFEST_HASH;
    const needsHydrate = nodes.some((el) => el.dataset?.hydrated !== "true");
    if (!needsHydrate && lastHash && manifest.hash && lastHash === manifest.hash) {
      return;
    }
  } catch (e) {
    rscLogger.debug("hydrate: hmr hash read failed", e);
  }
  if (nodes.length === 0) {
    try {
      globalThis.__VF_MANIFEST_HASH = manifest.hash || "";
    } catch (e) {
      rscLogger.debug("hydrate: set hash failed", e);
    }
    return;
  }

  // Test mode: allow HMR re-hydration assertions without loading React
  try {
    if (globalThis.__VF_TEST_MODE__) {
      globalThis.__VF_HYDRATE_CALLED = true;
      globalThis.__VF_MANIFEST_HASH = manifest.hash || "";
      return;
    }
  } catch (e) {
    rscLogger.debug("hydrate: test mode flags failed", e);
  }

  const { default: React } = await import(REACT_URL);
  const { createRoot } = await import(REACT_DOM_CLIENT_URL);

  for (const el of nodes) {
    const ref = el.dataset?.clientRef || "";
    if (!ref || el.dataset?.hydrated === "true") continue;
    const parsed = parseClientRef(ref);
    if (!parsed) continue;
    const mod = await importClientModule(manifest, parsed.rel);
    if (!mod) continue;
    const Cmp = mod[parsed.exportName] ?? mod.default;
    if (typeof Cmp !== "function") continue;
    try {
      const root: Root = createRoot(el);
      // Type assertion: Cmp is validated as function above
      root.render(React.createElement(Cmp as unknown as React.FC, {}));
      el.dataset.hydrated = "true";
    } catch (e) {
      rscLogger.warn("hydrate: render failed", e);
    }
  }
  try {
    globalThis.__VF_MANIFEST_HASH = manifest.hash || "";
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
