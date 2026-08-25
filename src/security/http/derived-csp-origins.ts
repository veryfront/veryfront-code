/**
 * Derive a project's CSP origins from the source it publishes.
 *
 * The platform floor lists what the *platform* emits. Anything a project loads
 * from elsewhere -- a stock-photo host, its own asset CDN, a video origin --
 * has to be admitted separately, and until now the only way to do that was
 * `security.csp`. That made a working site depend on configuration the project
 * had no reason to know it needed: an audit of the hosted fleet found ~100
 * projects loading blocked assets and two that had declared anything.
 *
 * This module closes that gap by reading the origins out of the project's own
 * released source, so `security.csp` becomes an override for what static
 * analysis cannot see rather than a prerequisite for a site that works.
 *
 * Two properties make that safe rather than merely convenient:
 *
 * 1. **Only passive-content directives are derived.** `img-src`, `media-src`
 *    and `font-src` decide whether a logo renders. `script-src` and
 *    `connect-src` decide whether a third party can execute code in the page
 *    or receive data from it. Deriving those would mean anyone able to
 *    influence source -- a compromised dependency, a merged pull request,
 *    CMS-authored MDX -- could grant themselves execution or an exfiltration
 *    endpoint, collapsing two independent barriers into one. Every project in
 *    the audit was fixed by passive directives alone.
 *
 * 2. **Origins come from an immutable release.** Derivation runs over the
 *    source a release pins, not over live content, so a script injected at
 *    runtime cannot extend the allowlist it is subject to.
 *
 * Derivation is deliberately incomplete. A URL assembled at runtime -- a
 * template literal, a CMS field, an environment variable -- is invisible here,
 * and those projects still declare `security.csp`. Under-deriving costs a
 * broken image; over-deriving costs the policy its meaning.
 *
 * @module security/http/derived-csp-origins
 */

import { compareStrings } from "#veryfront/utils/compare.ts";

/** Directives this module is permitted to contribute to. */
export const DERIVABLE_CSP_DIRECTIVES = Object.freeze(
  ["img-src", "media-src", "font-src"] as const,
);

export type DerivableCspDirective = (typeof DERIVABLE_CSP_DIRECTIVES)[number];

export type DerivedCspOrigins = Readonly<
  Partial<Record<DerivableCspDirective, readonly string[]>>
>;

/** A source file as the release stores it. */
export interface DerivationSourceFile {
  readonly path: string;
  readonly content?: string;
}

/**
 * Cap on how much of one file is scanned. A generated bundle or an inlined
 * data blob can be megabytes, and scanning it yields nothing a hand-written
 * source file would not.
 *
 * Measured in UTF-16 code units, matching `String.prototype.length`, because
 * that is the unit the regex engine actually steps through -- 512K code units
 * is the same amount of scanning whether they are ASCII or CJK. A UTF-8 byte
 * cap would read as the more natural bound but would not correspond to the
 * cost being bounded, and computing it means walking the string to decide how
 * much of the string to walk.
 */
const MAX_SCANNED_CHARS_PER_FILE = 512 * 1024;

/**
 * Upper bound on distinct origins, so a generated file cannot inflate the
 * policy. Origins are ranked before the cap applies -- see
 * {@link deriveCspOriginsFromSource}.
 */
const MAX_DERIVED_ORIGINS = 32;

/**
 * Every absolute https URL in the source, whatever syntax surrounds it.
 *
 * An earlier version of this matched by position -- `<img src>`, `url()`,
 * `poster` -- on the theory that knowing which element referenced a URL would
 * let each origin land in exactly the right directive. Measured against real
 * released content that recovers about a third of the references. The same
 * project reaches its asset host through `<img src>`, a JSX `imageSrc` prop,
 * YAML frontmatter, markdown `![](url)`, a bare string in a props array, a
 * `srcFallback` key, and `href` on a favicon link. Partial derivation is worse
 * than none: the site still breaks, but now it looks configured.
 *
 * Recall is what protects the project here, and precision is not what protects
 * the visitor -- the passive/active split is. An origin admitted for images
 * that is never referenced costs nothing; one that is missed costs a broken
 * page.
 */
const HTTPS_URL_PATTERN = /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?(?![a-zA-Z0-9.:-])/g;

/**
 * Reduce a URL to the `scheme://host[:port]` form CSP matches on.
 *
 * Returns undefined for anything unparseable, which is the same as declining
 * to derive from it.
 */
function toCspOrigin(rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (!parsed.hostname) return undefined;
  // A hostname with no dot is a bare label, not a public origin; a wildcard is
  // an unfilled template. Neither belongs in a served policy.
  if (!parsed.hostname.includes(".")) return undefined;
  if (parsed.hostname.includes("*")) return undefined;
  return parsed.port ? `https://${parsed.hostname}:${parsed.port}` : `https://${parsed.hostname}`;
}

function scanContent(content: string, into: Map<string, number>): void {
  const scanned = content.length > MAX_SCANNED_CHARS_PER_FILE
    ? content.slice(0, MAX_SCANNED_CHARS_PER_FILE)
    : content;

  for (const match of scanned.matchAll(HTTPS_URL_PATTERN)) {
    const origin = toCspOrigin(match[0]);
    if (origin) into.set(origin, (into.get(origin) ?? 0) + 1);
  }
}

/**
 * Collect the passive-content origins a project's source references.
 *
 * Pure over its input: callers hand it the file set a release pins, and the
 * result is stable for that set, which is what lets it be computed once per
 * release rather than per request.
 */
export function deriveCspOriginsFromSource(
  files: readonly DerivationSourceFile[],
): DerivedCspOrigins {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!file?.content) continue;
    scanContent(file.content, counts);
  }
  if (counts.size === 0) return Object.freeze({});

  // Rank by how often an origin is referenced before applying the cap.
  //
  // Truncating in discovery order looked fine until it was run over a real
  // project: one article yielded its asset CDN plus five hosts that appear
  // only as prose links. Across a content site those one-off links vastly
  // outnumber asset hosts, so an arbitrary cut can drop the very origin the
  // site depends on and silently reintroduce the breakage this exists to
  // prevent. An asset host is referenced from every page that uses it; a link
  // in body copy is referenced once. Frequency separates them cleanly.
  //
  // Ties break alphabetically so the result stays deterministic for a given
  // release, which is what lets the header and anything keyed on it be cached.
  const ranked = [...counts.entries()]
    .sort(([originA, countA], [originB, countB]) =>
      countB - countA || originA.localeCompare(originB)
    )
    .slice(0, MAX_DERIVED_ORIGINS)
    .map(([origin]) => origin)
    .sort(compareStrings);

  // Every retained origin is granted to all three passive directives rather
  // than routed between them. Splitting by file extension would reintroduce a
  // failure mode with no compensating benefit: an origin allowed for images
  // but not media is not a boundary anyone reasons about, while guessing wrong
  // leaves the asset blocked. The boundary that matters -- passive content
  // versus script and connect -- is enforced by this list, not by the split.
  const sorted = Object.freeze(ranked);
  const derived: Partial<Record<DerivableCspDirective, readonly string[]>> = {};
  for (const directive of DERIVABLE_CSP_DIRECTIVES) derived[directive] = sorted;
  return Object.freeze(derived);
}
