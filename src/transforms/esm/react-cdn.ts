/**
 * React CDN URL building.
 *
 * Everything that needs a React package served from esm.sh — import maps,
 * bundlers, the SSR adapter, release-asset builds — asks here, so that one
 * decision about how a React URL is spelled reaches all of them. The URLs
 * themselves are built by the import rewriter's URL builder; this module is
 * the React-shaped entry point onto it.
 */
import {
  buildReactUrl,
  DEFAULT_REACT_VERSION,
  getReactImportMap as buildReactImportMap,
} from "../import-rewriter/url-builder.ts";

export { DEFAULT_REACT_VERSION };

/** Build an esm.sh URL for one React package path. */
export function esmShReact(
  pkg: string,
  version: string,
  path = "",
  external = false,
): string {
  return buildReactUrl(
    pkg as "react" | "react-dom",
    version,
    path || undefined,
    external,
  );
}

/** Every React entry point a page can import, at one consistent version. */
export function getReactUrls(version?: string): Record<string, string> {
  const v = version ?? DEFAULT_REACT_VERSION;
  return {
    react: buildReactUrl("react", v),
    "react-dom": buildReactUrl("react-dom", v, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", v, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", v, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", v, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", v, "/jsx-dev-runtime", true),
  };
}

/** The same entry points shaped as an import map. */
export function getReactImportMap(version?: string): Record<string, string> {
  return buildReactImportMap(version ?? DEFAULT_REACT_VERSION);
}
