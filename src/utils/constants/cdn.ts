export const ESM_CDN_BASE = "https://esm.sh";
export const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
export const DENO_STD_BASE = "https://deno.land";

/** esm.sh build-system release used by audited framework dependency URLs. */
export const ESM_SH_BUILD_PIN = "v135";

/** Audited package versions shared by CDN consumers and import rewriting. */
export const MERMAID_VERSION = "11.16.0";
export const CSSTYPE_VERSION = "3.2.3";

export interface EsmShUrlOptions {
  external?: string[];
  target?: string;
  deps?: Record<string, string>;
  pin?: string;
}

/** Build a canonical esm.sh package URL. */
export function buildEsmShUrl(
  pkg: string,
  version?: string,
  subpath?: string,
  options?: EsmShUrlOptions,
): string {
  const params: string[] = [];

  if (options?.external?.length) {
    params.push(`external=${options.external.join(",")}`);
  }

  params.push(`target=${options?.target ?? "es2022"}`);

  if (options?.deps) {
    const deps = Object.entries(options.deps)
      .map(([name, dependencyVersion]) => `${name}@${dependencyVersion}`)
      .join(",");
    params.push(`deps=${deps}`);
  }

  if (options?.pin) params.push(`pin=${options.pin}`);

  const versionSegment = version ? `@${version}` : "";
  const pathSegment = subpath ?? "";
  return `${ESM_CDN_BASE}/${pkg}${versionSegment}${pathSegment}?${params.join("&")}`;
}

/** Build the shared React esm.sh URL used by SSR and browser rewriting. */
export function buildReactUrl(
  pkg: "react" | "react-dom",
  version: string,
  subpath?: string,
  external = false,
): string {
  return buildEsmShUrl(pkg, version, subpath, {
    external: external ? ["react"] : undefined,
    deps: { csstype: CSSTYPE_VERSION },
  });
}

/** Audited Mermaid release used by package and standalone preview renderers. */
export const MERMAID_ESM_URL = buildEsmShUrl(
  "mermaid",
  MERMAID_VERSION,
  undefined,
  { pin: ESM_SH_BUILD_PIN },
);

export const REACT_VERSION_17 = "17.0.2";
export const REACT_VERSION_18_2 = "18.2.0";
export const REACT_VERSION_18_3 = "18.3.1";
export const REACT_VERSION_19_RC = "19.0.0-rc.0";
export const REACT_VERSION_19 = "19.2.4";

/** Shared React default version value. */
export const REACT_DEFAULT_VERSION = REACT_VERSION_19;

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

export function getReactUrls(version = REACT_DEFAULT_VERSION): Record<string, string> {
  return {
    react: buildReactUrl("react", version),
    "react-dom": buildReactUrl("react-dom", version, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", version, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", version, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", version, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", version, "/jsx-dev-runtime", true),
  };
}

/** Return React import map. */
export function getReactImportMap(version = REACT_DEFAULT_VERSION): Record<string, string> {
  return {
    ...getReactUrls(version),
    "react/": buildReactUrl("react", version, "/", true),
  };
}

export function getReactCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version).react!;
}

export function getReactDOMCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom"]!;
}

export function getReactDOMClientCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom/client"]!;
}

export function getReactDOMServerCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom/server"]!;
}

export function getReactJSXRuntimeCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react/jsx-runtime"]!;
}

export function getReactJSXDevRuntimeCDNUrl(
  version = REACT_DEFAULT_VERSION,
): string {
  return getReactUrls(version)["react/jsx-dev-runtime"]!;
}

/** Default value for allowed cdn hosts. */
export const DEFAULT_ALLOWED_CDN_HOSTS = [ESM_CDN_BASE, DENO_STD_BASE];

export const DENO_STD_VERSION = "0.220.0";

/** Return Deno std node base. */
export function getDenoStdNodeBase(): string {
  return `${DENO_STD_BASE}/std@${DENO_STD_VERSION}/node`;
}

export { VERSION as VERYFRONT_VERSION } from "../version-constant.ts";
