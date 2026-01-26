import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { cacheModuleToLocal } from "../transforms/esm/http-cache.ts";
import { getReactUrls } from "../transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "../utils/cache-dir.ts";

type ReactDOMClientType = typeof import("react-dom/client");

let reactDOMClientCache: ReactDOMClientType | null = null;

async function loadReactDOMClient(): Promise<ReactDOMClientType> {
  if (reactDOMClientCache) return reactDOMClientCache;

  const urls = getReactUrls();
  const url = urls["react-dom/client"]!;

  if (isDeno) {
    reactDOMClientCache = (await import(url)) as ReactDOMClientType;
    return reactDOMClientCache;
  }

  if (isNode || isBun) {
    try {
      // Use indirect import to avoid dnt transformation
      const reactDomClientPkg = "react-dom/client";
      reactDOMClientCache =
        (await import(/* @vite-ignore */ reactDomClientPkg)) as ReactDOMClientType;
      return reactDOMClientCache;
    } catch {
      // Fall through to esm.sh caching
    }
  }

  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir);
  reactDOMClientCache = (await import(cachedPath)) as ReactDOMClientType;
  return reactDOMClientCache;
}

const reactDOMClient = await loadReactDOMClient();

type Any = any;

export default reactDOMClient;

export const createRoot = reactDOMClient.createRoot as Any;
export const hydrateRoot = reactDOMClient.hydrateRoot as Any;

export type { Container, Root, RootOptions } from "https://esm.sh/@types/react-dom@18.3.7/client";
