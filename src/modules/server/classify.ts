/**
 * Module Request Classification
 *
 * Classifies incoming module request URLs into a discriminated union, moving
 * the four URL-pattern regexes out of `serveModule` and providing a single
 * pure function that callers can switch on.
 *
 * @module modules/server/classify
 */

/** Prefix for dev-module URLs; exported for path stripping in module-server. */
export const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]{1,128})\.js$/;
// Cross-project import patterns: /_vf_modules/_cross/<slug>[@<version>]/@/<path>
const CROSS_PROJECT_VERSIONED_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)@([\d^~x][\d.x^~-]{0,127})\/\@\/(.+)$/;
const CROSS_PROJECT_LATEST_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)\/\@\/(.+)$/;
const RESERVED_SNIPPET_NAMESPACE = "/_vf_modules/_snippets";
const RESERVED_CROSS_PROJECT_NAMESPACE = "/_vf_modules/_cross";
const CROSS_PROJECT_SOURCE_MARKER = "/@/";

function isInNamespace(pathname: string, namespace: string): boolean {
  return pathname === namespace || pathname.startsWith(`${namespace}/`);
}

/**
 * Cross-project source keys use literal URL path segments. The registry route
 * does not define a percent-decoding contract, so forwarding a percent sign
 * would make admission depend on how many times an intermediary decodes it.
 */
function hasAmbiguousCrossProjectPath(path: string): boolean {
  return path.includes("%");
}

function normalizeCrossProjectVersionOperators(pathname: string): string {
  if (!isInNamespace(pathname, RESERVED_CROSS_PROJECT_NAMESPACE)) return pathname;

  const sourceMarkerIndex = pathname.indexOf(CROSS_PROJECT_SOURCE_MARKER);
  if (sourceMarkerIndex === -1) return pathname;

  const prefix = pathname.slice(0, sourceMarkerIndex);
  const sourcePath = pathname.slice(sourceMarkerIndex);
  return `${prefix.replace(/%5e/gi, "^")}${sourcePath}`;
}

/** URL does not start with any module prefix — not a module request. */
export interface NotModuleKind {
  kind: "not-module";
}

/** A request entered a framework-owned namespace but did not match its grammar. */
export interface InvalidModuleKind {
  kind: "invalid-module";
  namespace: "cross-project" | "snippet";
}

/** A compiled snippet module identified by its content hash. */
export interface SnippetKind {
  kind: "snippet";
  /** Hex hash of the snippet source. */
  hash: string;
}

/** A cross-project import pinned to a specific semver / range version. */
export interface CrossProjectVersionedKind {
  kind: "cross-project-versioned";
  slug: string;
  version: string;
  path: string;
}

/** A cross-project import resolved to the latest published version. */
export interface CrossProjectLatestKind {
  kind: "cross-project-latest";
  slug: string;
  path: string;
}

/** A regular project dev-module (including framework modules). */
export interface DevModuleKind {
  kind: "dev-module";
}

/**
 * Discriminated union of all recognised module URL shapes.
 *
 * Switch on `kind` to dispatch to the appropriate handler.
 */
export type ModuleRequestKind =
  | NotModuleKind
  | InvalidModuleKind
  | SnippetKind
  | CrossProjectVersionedKind
  | CrossProjectLatestKind
  | DevModuleKind;

/**
 * Classify a module request URL into one of the known module kinds.
 *
 * This is a pure function — it performs no I/O and has no side-effects.
 *
 * @param url - The parsed request URL.
 * @returns A `ModuleRequestKind` discriminated union.
 */
export function classifyModuleRequest(url: URL): ModuleRequestKind {
  const pathname = normalizeCrossProjectVersionOperators(url.pathname);

  if (!DEV_MODULE_PREFIX.test(pathname)) {
    return { kind: "not-module" };
  }

  const snippetMatch = pathname.match(SNIPPET_MODULE_PREFIX);
  if (snippetMatch) {
    return { kind: "snippet", hash: snippetMatch[1] ?? "" };
  }

  const versionedMatch = pathname.match(CROSS_PROJECT_VERSIONED_PREFIX);
  if (versionedMatch) {
    const path = versionedMatch[3] ?? "";
    if (hasAmbiguousCrossProjectPath(path)) {
      return { kind: "invalid-module", namespace: "cross-project" };
    }
    return {
      kind: "cross-project-versioned",
      slug: versionedMatch[1] ?? "",
      version: versionedMatch[2] ?? "",
      path,
    };
  }

  const latestMatch = pathname.match(CROSS_PROJECT_LATEST_PREFIX);
  if (latestMatch) {
    const path = latestMatch[2] ?? "";
    if (hasAmbiguousCrossProjectPath(path)) {
      return { kind: "invalid-module", namespace: "cross-project" };
    }
    return {
      kind: "cross-project-latest",
      slug: latestMatch[1] ?? "",
      path,
    };
  }

  if (isInNamespace(pathname, RESERVED_SNIPPET_NAMESPACE)) {
    return { kind: "invalid-module", namespace: "snippet" };
  }
  if (isInNamespace(pathname, RESERVED_CROSS_PROJECT_NAMESPACE)) {
    return { kind: "invalid-module", namespace: "cross-project" };
  }

  return { kind: "dev-module" };
}
