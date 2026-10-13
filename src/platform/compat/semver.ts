/** Shared version and npm range evaluation extracted from discovery and registry validation. */
const SEMVER_NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE_IDENTIFIER =
  `(?:${SEMVER_NUMERIC_IDENTIFIER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_PRERELEASE = `${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*`;
const SEMVER_BUILD_IDENTIFIER = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const EXACT_SEMVER_RE = new RegExp(
  `^v?${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}(?:-${SEMVER_PRERELEASE})?(?:\\+${SEMVER_BUILD_IDENTIFIER})?$`,
);

export function isExactSemver(s: string): boolean {
  return EXACT_SEMVER_RE.test(s);
}

/**
 * A single version, as opposed to a range: semver's `major.minor.patch` with
 * at most one pre-release part and at most one build part, in that order.
 *
 * Written so it cannot backtrack. The earlier form repeated one alternation
 * over both parts -- `(?:[-+][0-9A-Za-z.-]+)*` -- whose separator `-` is also
 * inside the body's character class, so a run of dashes could be split between
 * the repetitions in exponentially many ways and a non-matching tail made the
 * engine try all of them (CodeQL js/redos; `0.0.0+` followed by 40 dashes and
 * one invalid character took 4.7s to reject). Here each part appears at most
 * once and the two are told apart by a leading character the other part's body
 * cannot contain -- `+` is absent from the pre-release class -- so every
 * character has exactly one way to be consumed and matching is linear in the
 * length of the input.
 */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The comparison operators an npm range may put in front of a version, longest
 * first so `>=` is never read as `>`.
 */
const RANGE_OPERATORS = ["<=", ">=", "~>", "^", "~", "=", "v", "<", ">"] as const;

/**
 * The operators whose range does NOT let the version they mention be served.
 *
 * `^1.8.1`, `~1.8.1`, `~>1.8.1`, `>=1.8.1`, `<=1.8.1`, `=1.8.1`, `v1.8.1` and
 * a bare `1.8.1` all ADMIT 1.8.1, so fetching it serves a version the project
 * both wrote down and accepts. `<=` is among them: refusing it would turn a
 * valid, satisfiable entry into a hard failure.
 *
 * The two here do not: `>1.8.1` and `<1.8.1` exclude 1.8.1 outright, and
 * stripping the operator fetched the one version the declaration had ruled
 * out. Both route to the caller's conservative branch instead, exactly as an
 * unresolvable range such as `>=1 <2` does.
 */
const OPERATORS_NAMING_NO_FETCHABLE_VERSION: ReadonlySet<string> = new Set(["<", ">"]);

/**
 * The version a range comparator names, with its operator removed. npm also
 * accepts a `v` prefix after the operator (`^v1.2.3`, `>= v2`), so one is
 * dropped there too; a bare `v1.2.3` already reads `v` as its operator.
 */
function boundAfterOperator(trimmed: string, operator: string | undefined): string {
  if (operator === undefined) return trimmed;
  const bound = trimmed.slice(operator.length).trimStart();
  return operator !== "v" && /^v\d/.test(bound) ? bound.slice(1) : bound;
}

/** Anything carrying its own URL scheme (`https:`, `jsr:`, `data:`, ...). */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * The single exact version a dependency range names, or `null` when it names
 * none.
 *
 * This is the framework's whole answer to semver, and it is deliberately not a
 * resolver. `npm install` writes a caret range by default, so the common
 * package.json entry is `"unpdf": "^1.8.1"` -- and 1.8.1 is a version the
 * project literally wrote down and literally admits. Serving it is
 * reproducible: the same package.json always produces the same bundle, with no
 * registry round trip and no drift between two discovery passes.
 *
 * Anything that names no single version -- `*`, `1.x`, `>=1 <2`, `a || b`, a
 * dist-tag, `workspace:`, `file:`, a git URL -- returns `null`, and the caller
 * falls back to the runtime or reports a classified failure. Guessing a
 * version for those is the failure mode this whole path exists to stop.
 *
 * A version the range EXCLUDES is that same failure mode wearing a valid
 * declaration: `">1.8.1"` mentions 1.8.1 and refuses it, so reducing it to
 * 1.8.1 fetched the one version the project had ruled out. See
 * {@link OPERATORS_NAMING_NO_FETCHABLE_VERSION}.
 *
 * @internal Exported for testing only.
 */
export function exactVersionNamedByRange(range: unknown): string | null {
  if (typeof range !== "string") return null;
  const trimmed = range.trim();
  // A scheme (`workspace:`, `file:`, `npm:alias@x`, `git+ssh://`) is an alias,
  // not a version: whatever follows it is not this project's to fetch.
  if (URL_SCHEME.test(trimmed)) return null;
  const operator = RANGE_OPERATORS.find((candidate) => trimmed.startsWith(candidate));
  if (operator !== undefined && OPERATORS_NAMING_NO_FETCHABLE_VERSION.has(operator)) return null;
  const candidate = boundAfterOperator(trimmed, operator);
  return EXACT_VERSION.test(candidate) ? candidate : null;
}

/**
 * A version core as three digit strings. Semver puts no limit on a component,
 * so `Number` would collapse two distinct versions beyond 2^53 into one.
 */
type VersionCore = [string, string, string];

/** A digit string without leading zeros: `007` is `7`, `000` is `0`. */
function normalizeDigits(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}

/** Numeric order of two digit strings: longer is greater, then digit by digit. */
function compareDigits(left: string, right: string): number {
  const a = normalizeDigits(left);
  const b = normalizeDigits(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** One more than a digit string, carried by hand so no precision is lost. */
function incrementDigits(digits: string): string {
  const value = normalizeDigits(digits).split("");
  for (let index = value.length - 1; index >= 0; index--) {
    if (value[index] !== "9") {
      value[index] = String(Number(value[index]) + 1);
      return value.join("");
    }
    value[index] = "0";
  }
  return `1${value.join("")}`;
}

/** A version core as a range may abbreviate it: `2`, `2.3.x`, `2.3.4`, `*`. */
export const PARTIAL_VERSION = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

/**
 * A range bound's numeric parts, truncated at its first wildcard: `2` is
 * `["2"]`, `2.3.x` is `["2", "3"]`, `*` and `x.2.3` are both `[]`. `null` for
 * anything that is not a version core at all.
 *
 * Everything after a wildcard is dropped rather than rejected, because npm
 * drops it too: its bundled semver reads `1.x.3` as `1.x` and normalizes both
 * to `>=1.0.0 <2.0.0-0`. Rejecting the declaration instead made a package the
 * project had installed and locked unevaluable, so discovery reported it
 * missing.
 */
function boundParts(bound: string): string[] | null {
  const core = EXACT_VERSION.test(bound) ? bound.split(/[-+]/, 1)[0]! : bound;
  const match = PARTIAL_VERSION.exec(core);
  if (!match) return null;
  const groups = match.slice(1);
  const gap = groups.findIndex((part) => part === undefined || !/^\d+$/.test(part));
  const numeric = gap < 0 ? groups : groups.slice(0, gap);
  return numeric.map((part) => normalizeDigits(part!));
}

function padded(parts: readonly string[]): VersionCore {
  return [parts[0] ?? "0", parts[1] ?? "0", parts[2] ?? "0"];
}

/** The version just past every one a partial bound covers: `2.3` -> `2.4.0`. */
function nextAfter(parts: readonly string[]): VersionCore {
  const next = [...parts];
  next[next.length - 1] = incrementDigits(next.at(-1)!);
  return padded(next);
}

/** The exclusive upper bound of a caret range, per npm's rules for `0.x`. */
function caretCeiling(parts: readonly string[]): VersionCore {
  const firstNonZero = parts.findIndex((part) => normalizeDigits(part) !== "0");
  return nextAfter(parts.slice(0, firstNonZero < 0 ? parts.length : firstNonZero + 1));
}

/** The exclusive upper bound of a tilde range: the minor for a full version. */
function tildeCeiling(parts: readonly string[]): VersionCore {
  return nextAfter(parts.length === 3 ? parts.slice(0, 2) : parts);
}

/** The zero version core, which npm's range expansion treats as no bound. */
const ZERO_CORE: VersionCore = ["0", "0", "0"];

export function coreOf(version: string): VersionCore {
  return padded(version.split(/[-+]/, 1)[0]!.split(".").map(normalizeDigits));
}

/** A version's pre-release identifiers, without build metadata; `null` if none. */
export function prereleaseOf(version: string): string[] | null {
  const withoutBuild = version.split("+", 1)[0]!;
  const dash = withoutBuild.indexOf("-");
  return dash < 0 ? null : withoutBuild.slice(dash + 1).split(".");
}

/** Semver pre-release precedence: a release outranks any of its pre-releases. */
function comparePrereleases(left: string[] | null, right: string[] | null): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    // Compared by digits, not by Number: a numeric identifier has no length
    // limit under semver, and two beyond 2^53 can collapse to the same value.
    if (aNumeric && bNumeric) {
      const left = a.replace(/^0+(?=\d)/, "");
      const right = b.replace(/^0+(?=\d)/, "");
      if (left.length !== right.length) return left.length < right.length ? -1 : 1;
      if (left === right) continue;
      return left < right ? -1 : 1;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareVersions(
  left: { core: VersionCore; pre: string[] | null },
  right: { core: VersionCore; pre: string[] | null },
): number {
  return compareCores(left.core, right.core) || comparePrereleases(left.pre, right.pre);
}

function compareCores(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < 3; index++) {
    const order = compareDigits(left[index] ?? "0", right[index] ?? "0");
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * npm's any-release comparator spelled as a bound: its bundled semver rewrites
 * a `>=` at zero to the same empty comparator `*` becomes, and then drops it
 * from any set that holds another. `>=0.0.0 >=0.0.0-alpha` is therefore just
 * `>=0.0.0-alpha`, which admits `0.0.0-beta`.
 *
 * Every spelling that expands to `0.0.0` counts -- `>=0`, `>=0.0`, `>=0.x`,
 * `>=0.0.x` -- because the expansion runs before the rewrite. Build metadata
 * prevents the rewrite, though: `>=0.0.0+build` remains an ordinary lower
 * bound. A `v` prefix is normalized before the same zero-bound rewrite.
 */
const ANY_RELEASE_COMPARATOR = /^>=\s*v?(?:0|[xX*])(?:\.(?:0|[xX*])){0,2}$/;

/**
 * Does a single-comparator range admit an exact version? `null` when the range
 * is not one this module evaluates -- `>=1 <2`, `a || b`, a dist-tag, a scheme
 * -- so the caller decides what an unchecked range means for it.
 *
 * Covers an operator (`^`, `~`, `~>`, `>=`, `>`, `<=`, `<`, `=`, `v`) or none,
 * in front of a full version (`1.8.1`) or an abbreviated one (`2`, `2.3`,
 * `2.x`, `*`), with npm's meaning for each: `^2` is `>=2.0.0 <3.0.0`, `>2` is
 * `>=3.0.0`, `<=2.3` is `<2.4.0`. Versions compare by semver precedence, and a
 * pre-release is admitted only by a range that names a pre-release on the same
 * core version, as npm does: `^1.2.3-beta.1` admits `1.2.3-beta.2` and `1.2.3`,
 * never `1.3.0-rc.1`.
 *
 * @internal Exported for testing only.
 */
function comparatorAdmitsVersion(
  range: string,
  version: string,
  prereleaseAdmitted = false,
): boolean | null {
  const trimmed = range.trim();
  if (URL_SCHEME.test(trimmed) || !EXACT_VERSION.test(version)) return null;
  const operator = RANGE_OPERATORS.find((candidate) => trimmed.startsWith(candidate));
  const bound = boundAfterOperator(trimmed, operator);
  const wanted = { core: coreOf(version), pre: prereleaseOf(version) };
  const anyRelease = ANY_RELEASE_COMPARATOR.test(trimmed);
  const parts = anyRelease ? [] : boundParts(bound);
  if (parts === null) return null;
  if (parts.length === 0) {
    // `*`, `x`, their repeated forms (`*.*`, `x.x.x`) and anything npm
    // truncates to one (`x.2.3`) are all "any release", and npm reads a
    // non-strict operator in front of one (`^*`, `>=*`) the same way. A strict
    // one is npm's EMPTY range: no version is above every version.
    if (!anyRelease && (operator === ">" || operator === "<")) return false;
    // An any-release comparator admits no pre-release of its own, and vetoes
    // none another comparator in the set has admitted -- npm skips it entirely
    // when deciding whether the set names a pre-release.
    return wanted.pre === null || prereleaseAdmitted;
  }
  const full = parts.length === 3;
  const lower = { core: padded(parts), pre: full ? prereleaseOf(bound) : null };
  // npm's pre-release rule: a pre-release is admitted only by a range that
  // names a pre-release on the same core version.
  if (
    wanted.pre !== null && !prereleaseAdmitted &&
    (lower.pre === null || compareCores(wanted.core, lower.core) !== 0)
  ) {
    return false;
  }
  return boundAdmitsVersion(operator, parts, full, wanted, lower);
}

/**
 * Does the bound a comparator names admit the version, once the pre-release
 * rule has had its say? `parts` is the bound's numeric core as written, so its
 * length is what tells an abbreviated bound from a full one.
 */
function boundAdmitsVersion(
  operator: string | undefined,
  parts: readonly string[],
  full: boolean,
  wanted: { core: VersionCore; pre: string[] | null },
  lower: { core: VersionCore; pre: string[] | null },
): boolean {
  const order = compareVersions(wanted, lower);
  // A DERIVED lower bound AT ZERO vanishes: npm expands `^0`, `~0.0`, `0.x`
  // and a hyphen range's left side to a set whose `>=0.0.0` it then rewrites
  // to the empty comparator and drops. `0 ~0.0.0-0` is therefore just
  // `<1.0.0-0 >=0.0.0-0 <0.1.0-0`, which admits `0.0.0-0` -- a version that
  // sorts below the 0.0.0 release the bound was written as.
  const lowerDropped = lower.pre === null && compareCores(lower.core, ZERO_CORE) === 0;
  // A DERIVED upper bound carries npm's `-0` sentinel: `^1.2.3` expands to
  // `<2.0.0-0` and `<=1.1` to `<1.2.0-0`, both of which every pre-release of
  // the ceiling outranks. So the test is on the core alone -- under the
  // ceiling's core, pre-release or not; never on it. Comparing against the
  // ceiling RELEASE instead admitted `1.2.0-alpha` under `<=1.1`, a version
  // the declaration excludes.
  const below = (ceiling: VersionCore) => compareCores(wanted.core, ceiling) < 0;
  // A LOWER bound derived from a partial version is npm's release boundary:
  // `>1.1` expands to `>=1.2.0`, and `1.2.0-beta` precedes that release.
  const atLeast = (boundary: VersionCore) =>
    compareVersions(wanted, { core: boundary, pre: null }) >= 0;
  switch (operator) {
    case "^":
      return (lowerDropped || order >= 0) && below(caretCeiling(parts));
    case "~":
    case "~>":
      return (lowerDropped || order >= 0) && below(tildeCeiling(parts));
    case ">=":
      return full ? order >= 0 : atLeast(padded(parts));
    case ">":
      return full ? order > 0 : atLeast(nextAfter(parts));
    case "<=":
      return full ? order <= 0 : below(nextAfter(parts));
    case "<":
      // Written in full, `<` is the bound as written, pre-release included:
      // `<2.0.0` admits `2.0.0-alpha`. Abbreviated, it is npm's `-0` sentinel:
      // `<1.x` expands to `<1.0.0-0`, which admits no pre-release of 1.0.0.
      return full ? order < 0 : below(padded(parts));
    default:
      // `=`, `v` and no operator cover exactly the versions the bound names.
      // Written in full that is one equality comparator, which npm keeps as
      // written; abbreviated it is a range, whose zero lower bound vanishes.
      return full
        ? order === 0
        : (lowerDropped || atLeast(padded(parts))) && below(nextAfter(parts));
  }
}

/**
 * Is this comparator npm's any-release one, the one it rewrites to the empty
 * comparator? `*`, `x`, `x.2.3`, `>=0.0.0` and every non-strict operator in
 * front of a wildcard (`^*`, `>=*`) are; `>*` and `<*` are its EMPTY range.
 */
function isAnyReleaseComparator(comparator: string): boolean {
  const trimmed = comparator.trim();
  if (ANY_RELEASE_COMPARATOR.test(trimmed)) return true;
  const operator = RANGE_OPERATORS.find((candidate) => trimmed.startsWith(candidate));
  if (operator === ">" || operator === "<") return false;
  return boundParts(boundAfterOperator(trimmed, operator))?.length === 0;
}

/** The comparators one `||` alternative is made of; `["*"]` when it is empty. */
function comparatorsOf(alternative: string): string[] {
  // npm allows whitespace between an operator and its version.
  const set = alternative.trim().replace(/(<=|>=|~>|[<>=^~])\s+/g, "$1");
  if (set.length === 0) return ["*"];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
  return hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : set.split(/\s+/);
}

/** Does this comparator name a pre-release on the same core as `version`? */
function namesPrereleaseOnCore(comparator: string, version: string): boolean {
  const trimmed = comparator.trim();
  const operator = RANGE_OPERATORS.find((candidate) => trimmed.startsWith(candidate));
  const bound = boundAfterOperator(trimmed, operator);
  if (!EXACT_VERSION.test(bound) || prereleaseOf(bound) === null) return false;
  return compareCores(coreOf(bound), coreOf(version)) === 0;
}

/**
 * Does a range admit an exact version? `null` when the range is not one this
 * module evaluates, so the caller decides what an unchecked range means.
 *
 * A range is alternatives joined by `||`, each a set of comparators that must
 * all hold, with `a - b` as npm's inclusive hyphen form. One unevaluable
 * comparator makes the whole range unevaluable rather than quietly false.
 *
 * @internal Exported for testing only.
 */
export function rangeAdmitsVersion(range: string, version: string): boolean | null {
  const trimmed = range.trim();
  if (URL_SCHEME.test(trimmed)) return null;
  const alternatives = trimmed.split("||").map(comparatorsOf);
  let admitted = false;
  let universal = false;
  for (const comparators of alternatives) {
    // npm's pre-release rule applies to the SET: a pre-release is admitted
    // when one comparator names a pre-release on the same core, and the other
    // comparators are then read without that veto of their own.
    const prereleaseAdmitted = comparators.some((comparator) =>
      namesPrereleaseOnCore(comparator, version)
    );
    // Every comparator is evaluated: one this module cannot read makes the
    // whole range unevaluable, even when an earlier one already refused.
    let holds = true;
    for (const comparator of comparators) {
      const verdict = comparatorAdmitsVersion(comparator, version, prereleaseAdmitted);
      if (verdict === null) return null;
      if (!verdict) holds = false;
    }
    if (comparators.every(isAnyReleaseComparator)) universal = true;
    if (holds) admitted = true;
  }
  // One any-release alternative collapses the WHOLE range: npm keeps only that
  // set, so `* || ^1.2.3-alpha` is `*` and excludes `1.2.3-alpha` even though
  // the second alternative names it. Accumulating that alternative's admission
  // instead fetched a pre-release the declaration does not admit.
  return universal ? comparatorAdmitsVersion("*", version) : admitted;
}

/** Whether a value names one exact semantic version. */
export const valid = isExactSemver;

/** Admit only ranges understood by the existing evaluator. */
export function satisfies(version: string, declaration: string): boolean {
  if (!isExactSemver(version)) return false;
  return rangeAdmitsVersion(declaration, version.replace(/^v/, "")) === true;
}
