/**
 * URL construction for the module server, the RSC module endpoint and the
 * page-data endpoint. All pure, so they are directly testable.
 */

import type { PageDataPayload } from "./env.ts";

export function appendQueryParam(url: string, key: string, value: string): string {
  return url + (url.includes("?") ? "&" : "?") + key + "=" + value;
}

/**
 * Rewrite a module URL so it resolves inside the rendered dependency snapshot.
 *
 * Module-server URLs get a `/_pins/<key>/` path segment rather than a query
 * parameter, because relative child imports inside the module must stay pinned
 * too — a query string would not survive `new URL('./child.js', parent)`.
 * Anything else falls back to a `pins` query parameter.
 */
export function appendDependencyPinningVersion(
  url: string,
  moduleData: { dependencyPinningCacheKey?: string } | undefined | null,
): string {
  const pinKey = moduleData && moduleData.dependencyPinningCacheKey;
  if (typeof pinKey !== "string" || !pinKey.startsWith("on:")) return url;

  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf("?");
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");

  const modulePrefix = "/_vf_modules/";
  const prefixIndex = base.indexOf(modulePrefix);
  const origin = prefixIndex >= 0 ? base.slice(0, prefixIndex) : "";
  if (
    prefixIndex >= 0 &&
    (origin === "" || /^https?:\/\/[^/]+$/i.test(origin))
  ) {
    const pathStart = prefixIndex + modulePrefix.length;
    let modulePath = base.slice(pathStart);
    if (modulePath.startsWith("_pins/")) {
      const existingKeyEnd = modulePath.indexOf("/", "_pins/".length);
      const encodedExistingKey = existingKeyEnd < 0
        ? modulePath.slice("_pins/".length)
        : modulePath.slice("_pins/".length, existingKeyEnd);
      let existingKey;
      try {
        existingKey = decodeURIComponent(encodedExistingKey);
      } catch {
        existingKey = undefined;
      }
      if (existingKey && /^on:[A-Za-z0-9._-]+$/.test(existingKey)) {
        if (existingKeyEnd < 0) return url;
        modulePath = modulePath.slice(existingKeyEnd + 1);
      }
    }
    params.delete("pins");
    const query = params.toString();
    return (
      base.slice(0, pathStart) +
      "_pins/" +
      encodeURIComponent(pinKey) +
      "/" +
      modulePath +
      (query ? "?" + query : "") +
      hash
    );
  }

  params.set("pins", pinKey);
  return base + "?" + params.toString() + hash;
}

/** Components loaded under different snapshots are different components. */
export function componentCacheKey(
  path: string,
  moduleData: { dependencyPinningCacheKey?: string } | undefined | null,
): string {
  const pinKey = moduleData && moduleData.dependencyPinningCacheKey;
  return typeof pinKey === "string" && pinKey.startsWith("on:")
    ? path + "|vf_pins|" + pinKey
    : path;
}

export function normalizeReleaseAssetModulePath(path: string | undefined | null): string {
  return String(path || "")
    .replace(/^\/?_vf_modules\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "");
}

/** The hardened RSC endpoint used for App Router and isolated client pages. */
export function buildPinnedRscModuleUrl(
  path: string,
  moduleData: { dependencyPinningCacheKey?: string } | undefined | null,
): string {
  let moduleUrl = "/_veryfront/rsc/module?rel=" + encodeURIComponent(path);
  const pinKey = moduleData && moduleData.dependencyPinningCacheKey;
  if (typeof pinKey === "string" && pinKey.startsWith("on:")) {
    moduleUrl += "&pins=" + encodeURIComponent(pinKey);
  }
  return moduleUrl;
}

/**
 * The page-data endpoint for a route, preserving the route's query string.
 *
 * TODO(convergence): routing/client/page-loader.ts builds the same endpoint but
 * maps `/` to `index` where this maps it to the empty string, so the two
 * produce different URLs for the root route and cannot be collapsed here.
 */
export function buildPageDataEndpoint(path: string, origin: string): string {
  const targetUrl = new URL(path, origin);
  const normalizedPath = targetUrl.pathname === "/" ? "" : targetUrl.pathname.replace(/^\//, "");
  const endpointUrl = new URL(
    "/_veryfront/page-data/" + normalizedPath + ".json",
    origin,
  );
  endpointUrl.search = targetUrl.search;
  return endpointUrl.pathname + endpointUrl.search;
}

/** Cache identity for page data, so a snapshot change cannot serve stale data. */
export function pageDataCacheIdentity(
  path: string,
  documentDependencyPinningCacheKey: string | null,
): string {
  return documentDependencyPinningCacheKey
    ? documentDependencyPinningCacheKey + "|path:" + path
    : path;
}

/**
 * Page data must have been rendered against the same dependency snapshot as the
 * document, or the client would mix modules from two builds.
 */
export function assertPageDataMatchesDocumentSnapshot(
  path: string,
  data: PageDataPayload,
  documentDependencyPinningCacheKey: string | null,
): PageDataPayload {
  if (!documentDependencyPinningCacheKey) return data;
  if (data && data.dependencyPinningCacheKey === documentDependencyPinningCacheKey) {
    return data;
  }

  const error = new Error("Page data dependency snapshot does not match the document") as Error & {
    status?: number;
    dependencySnapshotMismatch?: boolean;
    path?: string;
  };
  error.status = 409;
  error.dependencySnapshotMismatch = true;
  error.path = path;
  throw error;
}
