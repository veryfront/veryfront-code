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
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]+)\.js/;
// Cross-project import patterns: /_vf_modules/_cross/<slug>[@<version>]/@/<path>
const CROSS_PROJECT_VERSIONED_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/\@\/(.+)$/;
const CROSS_PROJECT_LATEST_PREFIX = /^\/_vf_modules\/_cross\/([a-z0-9-]+)\/\@\/(.+)$/;

/** URL does not start with any module prefix — not a module request. */
export interface NotModuleKind {
  kind: "not-module";
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
  if (!DEV_MODULE_PREFIX.test(url.pathname)) {
    return { kind: "not-module" };
  }

  const snippetMatch = url.pathname.match(SNIPPET_MODULE_PREFIX);
  if (snippetMatch) {
    return { kind: "snippet", hash: snippetMatch[1] ?? "" };
  }

  const versionedMatch = url.pathname.match(CROSS_PROJECT_VERSIONED_PREFIX);
  if (versionedMatch) {
    return {
      kind: "cross-project-versioned",
      slug: versionedMatch[1] ?? "",
      version: versionedMatch[2] ?? "",
      path: versionedMatch[3] ?? "",
    };
  }

  const latestMatch = url.pathname.match(CROSS_PROJECT_LATEST_PREFIX);
  if (latestMatch) {
    return {
      kind: "cross-project-latest",
      slug: latestMatch[1] ?? "",
      path: latestMatch[2] ?? "",
    };
  }

  return { kind: "dev-module" };
}
