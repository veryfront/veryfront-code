/**
 * Classifying a project's npm imports for the discovery bundler.
 *
 * The discovery bundler externalizes bare specifiers (`packages: "external"`)
 * and `rewriteForDeno` turns what survives into an `npm:` specifier. A
 * `deno compile` binary answers those only from the npm snapshot frozen into
 * it at build time, so a project's own dependency -- never part of the
 * framework's lock -- comes back as `Could not find constraint
 * '<pkg>@<version>' in the list of packages` (veryfront-issue-inbox#1440).
 *
 * THE PRECEDENCE, in order. Every branch below is one of these:
 *
 * 1. A framework-identity specifier is ALWAYS external. That is the framework
 *    itself, React, the schema library, `@opentelemetry/*`, and every Node
 *    builtin in both its bare and `node:` form. A second copy would break the
 *    identity comparisons the schema and element registries make against the
 *    framework's own objects, and a Node builtin has no npm coordinate at all.
 * 2. An import whose version the project's declaration does not admit, or
 *    whose range excludes the declared version, is refused outright: serving
 *    the declared version would run code the import did not ask for.
 * 3. A version the runtime already embeds stays external, as the single
 *    offline copy.
 * 4. A declaration the runtime does NOT carry is inlined from the version that
 *    declaration names, at bundle time -- the only moment the package can
 *    still be materialised.
 * 5. With no usable declaration, a package stays external only under an
 *    import constraint the runtime recorded and that both the declaration (if
 *    any) and the import's own range (if any) admit. It is re-emitted under
 *    that constraint: a compiled binary resolves `npm:` imports by constraint,
 *    so an unconstrained `npm:<name>` fails even when the package is carried.
 * 6. Anything left fails as a classified DEPENDENCY_MISSING naming the
 *    package, instead of Deno's raw constraint text.
 */

import {
  EMBEDDED_NPM_CONSTRAINTS,
  EMBEDDED_NPM_PACKAGES,
  PROXY_EMBEDDED_NPM_CONSTRAINTS,
  PROXY_EMBEDDED_NPM_PACKAGES,
} from "./embedded-npm-packages.generated.ts";

/**
 * Specifiers the framework itself hands to discovered modules. Serving these
 * from a CDN would bind a discovered tool to a second copy of the framework,
 * of React, or of the schema library whose instance the registries compare
 * against, so neither a project pin nor a version in the specifier redirects
 * them. esbuild consults plugins before the `external` array, so this is the
 * guard that keeps them external, not a belt-and-braces duplicate of it.
 */
const FRAMEWORK_PROVIDED_PACKAGES = new Set(["veryfront", "react", "react-dom", "zod"]);

/**
 * Node builtins, which a project may import bare (`fs`) as well as prefixed
 * (`node:fs`). Neither form has an npm coordinate, so neither can be pinned,
 * fetched or found in the embedded set: both are the runtime's to answer.
 *
 * Without the bare half of this list every compiled discovery run classified
 * `import { readFile } from "fs"` as a missing project dependency and told the
 * user to declare `fs` in package.json, which is advice that cannot work.
 */
// `sea`, `sqlite` and `test` are absent on purpose: Node exposes them only under
// the mandatory `node:` prefix, so a bare `test` is the npm package of that name.
const NODE_BUILTIN_MODULES = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * The builtin subpaths Node exposes without the `node:` prefix
 * (`require("node:module").builtinModules`); any other path under a builtin
 * root is not a builtin.
 */
const NODE_BUILTIN_SUBPATHS = new Set([
  "assert/strict",
  "dns/promises",
  "fs/promises",
  "inspector/promises",
  "path/posix",
  "path/win32",
  "readline/promises",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "timers/promises",
  "util/types",
]);

/**
 * The `node:`-prefixed form of a bare Node builtin specifier, or `null` when
 * the specifier is not one.
 *
 * `rewriteBareNpmImportsForDeno` prefixes every surviving bare specifier with
 * `npm:`, so leaving `crypto` bare makes the emitted module import
 * `npm:crypto` -- a real but unrelated npm shim package, which a compiled
 * binary does not carry at all. Resolving to `node:crypto` at bundle time is
 * what actually hands the import to the runtime, on Deno and on Node alike.
 */
export function nodeBuiltinSpecifier(name: string): string | null {
  if (name.startsWith("node:")) return name;
  // Only the exact subpaths Node exposes are builtins: `buffer/` is the npm
  // `buffer` package and `fs/custom` is nothing, so neither has a `node:` form.
  const builtin = name.includes("/")
    ? NODE_BUILTIN_SUBPATHS.has(name)
    : NODE_BUILTIN_MODULES.has(name);
  return builtin ? `node:${name}` : null;
}

/**
 * Is this specifier one only the runtime may answer -- either because the
 * framework hands its own instance to discovered modules, or because it is a
 * Node builtin with no npm coordinate at all?
 */
export function isFrameworkProvidedPackage(name: string): boolean {
  if (FRAMEWORK_PROVIDED_PACKAGES.has(name)) return true;
  if (name.startsWith("veryfront/")) return true;
  if (name.startsWith("@opentelemetry/")) return true;
  return nodeBuiltinSpecifier(name) !== null;
}

/**
 * An npm package name, per the registry's own rules. Specifiers that are not
 * one -- `#veryfront/...` subpath imports, bare aliases from an import map --
 * are none of this module's business and are left to the rest of the bundle.
 */
// Unscoped names admit uppercase: the registry still serves grandfathered
// packages such as `JSONStream`.
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[A-Za-z0-9~][A-Za-z0-9-._~]*$/;

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
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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
  const candidate = operator === undefined ? trimmed : trimmed.slice(operator.length).trimStart();
  return EXACT_VERSION.test(candidate) ? candidate : null;
}

type VersionCore = [number, number, number];

/**
 * A range bound's numeric parts, as written: `2` is `[2]`, `2.3.x` is `[2, 3]`,
 * `2.3.4` is `[2, 3, 4]`. `null` for anything else, including a wildcard
 * followed by a number (`1.x.3`).
 */
const PARTIAL_VERSION = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

function boundParts(bound: string): number[] | null {
  const core = EXACT_VERSION.test(bound) ? bound.split(/[-+]/, 1)[0]! : bound;
  const match = PARTIAL_VERSION.exec(core);
  if (!match) return null;
  const isNumber = (part: string | undefined) => part !== undefined && /^\d+$/.test(part);
  const groups = match.slice(1);
  const gap = groups.findIndex((part) => !isNumber(part));
  if (gap < 0) return groups.map(Number);
  // A number after a wildcard names no range npm would read the same way.
  if (groups.slice(gap).some(isNumber)) return null;
  return groups.slice(0, gap).map(Number);
}

function padded(parts: readonly number[]): VersionCore {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** The version just past every one a partial bound covers: `2.3` -> `2.4.0`. */
function nextAfter(parts: readonly number[]): VersionCore {
  const next = [...parts];
  next[next.length - 1]! += 1;
  return padded(next);
}

/** The exclusive upper bound of a caret range, per npm's rules for `0.x`. */
function caretCeiling(parts: readonly number[]): VersionCore {
  const firstNonZero = parts.findIndex((part) => part !== 0);
  return nextAfter(parts.slice(0, firstNonZero < 0 ? parts.length : firstNonZero + 1));
}

/** The exclusive upper bound of a tilde range: the minor for a full version. */
function tildeCeiling(parts: readonly number[]): VersionCore {
  return nextAfter(parts.length === 3 ? parts.slice(0, 2) : parts);
}

function coreOf(version: string): VersionCore {
  return padded(version.split(/[-+]/, 1)[0]!.split(".").map(Number));
}

/** A version's pre-release identifiers, without build metadata; `null` if none. */
function prereleaseOf(version: string): string[] | null {
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
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function compareVersions(
  left: { core: VersionCore; pre: string[] | null },
  right: { core: VersionCore; pre: string[] | null },
): number {
  return compareCores(left.core, right.core) || comparePrereleases(left.pre, right.pre);
}

function compareCores(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}

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
export function rangeAdmitsVersion(range: string, version: string): boolean | null {
  const trimmed = range.trim();
  if (URL_SCHEME.test(trimmed) || !EXACT_VERSION.test(version)) return null;
  const operator = RANGE_OPERATORS.find((candidate) => trimmed.startsWith(candidate));
  const bound = operator === undefined ? trimmed : trimmed.slice(operator.length).trimStart();
  const wanted = { core: coreOf(version), pre: prereleaseOf(version) };
  if (operator === undefined && (bound === "*" || bound === "x" || bound === "X")) {
    return wanted.pre === null;
  }
  const parts = boundParts(bound);
  if (parts === null) return null;
  const full = parts.length === 3;
  const lower = { core: padded(parts), pre: full ? prereleaseOf(bound) : null };
  // npm's pre-release rule: a pre-release is admitted only by a range that
  // names a pre-release on the same core version.
  if (wanted.pre !== null && (lower.pre === null || compareCores(wanted.core, lower.core) !== 0)) {
    return false;
  }

  const order = compareVersions(wanted, lower);
  const below = (ceiling: VersionCore) => compareCores(wanted.core, ceiling) < 0;
  switch (operator) {
    case "^":
      return order >= 0 && below(caretCeiling(parts));
    case "~":
    case "~>":
      return order >= 0 && below(tildeCeiling(parts));
    case ">=":
      return order >= 0;
    case ">":
      return full ? order > 0 : !below(nextAfter(parts));
    case "<=":
      return full ? order <= 0 : below(nextAfter(parts));
    case "<":
      return order < 0;
    default:
      // `=`, `v` and no operator cover exactly the versions the bound names.
      return full ? order === 0 : order >= 0 && below(nextAfter(parts));
  }
}

export interface ParsedNpmSpecifier {
  /** Package name, without the `npm:` scheme, the version or the subpath. */
  name: string;
  /** The version or range written into the specifier; `null` when bare. */
  version: string | null;
  /** `.` for the package root, otherwise `./sub/path`. */
  subpath: string;
}

/**
 * Split any of the forms a project can write into name, version and subpath:
 * `unpdf`, `unpdf/dist/x`, `@scope/pkg`, `@scope/pkg/sub`, `npm:unpdf@1.8.1`,
 * `npm:unpdf@1.8.1/sub`, `npm:@scope/pkg@2.0.0`, `npm:unpdf`.
 *
 * Returns `null` for anything that is not an npm package specifier. The
 * explicit `npm:` form is the one that matters most here: the production
 * failure used it, and `splitPackageSubpath` reads it as the whole name.
 */
export function parseNpmSpecifier(specifier: string): ParsedNpmSpecifier | null {
  let rest = specifier;
  if (rest.startsWith("npm:")) {
    rest = rest.slice(4);
    // Deno also accepts `npm:/pkg`.
    if (rest.startsWith("/")) rest = rest.slice(1);
  } else if (URL_SCHEME.test(rest)) {
    return null;
  }

  let scope = "";
  if (rest.startsWith("@")) {
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    scope = rest.slice(0, slash + 1);
    rest = rest.slice(slash + 1);
  }

  // `rest` is now `name[@version][/subpath]` with the scope stripped off. A
  // version belongs to the package-name segment only: `pkg/foo@bar` is the
  // subpath `./foo@bar` of `pkg`, not `pkg/foo` at version `bar`.
  const slash = rest.indexOf("/");
  const head = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? "" : rest.slice(slash + 1);
  const at = head.indexOf("@");
  const name = scope + (at > 0 ? head.slice(0, at) : head);
  const version = at > 0 ? head.slice(at + 1) || null : null;

  if (!NPM_PACKAGE_NAME.test(name)) return null;
  return { name, version, subpath: tail ? `./${tail}` : "." };
}

export type ProjectNpmImport =
  /** Leave the specifier external; the runtime resolves it. */
  | {
    kind: "runtime";
    /** The coordinate to externalize instead of the specifier as written. */
    specifier?: string;
  }
  /** Inline the package from its pinned CDN source at bundle time. */
  | { kind: "cdn"; name: string; version: string; subpath: string }
  /** Nothing can resolve this specifier; report it rather than let Deno. */
  | { kind: "missing"; name: string; reason: string };

/**
 * Which compiled binary this process is.
 *
 * `deno compile` freezes the npm set of the lockfile it resolved against, and
 * the two binary profiles do not resolve against the same lockfile: the full
 * profile uses this repo's `deno.lock`, the proxy profile uses
 * `scripts/build/proxy-deno.lock` (see `createCompileArgs` in
 * scripts/build/compile-binary.ts). src/discovery is inside cli/proxy-main.ts's
 * module graph, so a single embedded set would over-report by hundreds of
 * packages on a proxy binary -- the unsafe direction, because a package
 * wrongly called embedded is left external and then fails at run time.
 *
 * cli/proxy-main.ts sets this global at module scope, before any discovery can
 * run. It is the only place the two profiles are distinguishable from inside
 * the binary: `runStandaloneProxyRuntime` is shared with
 * `veryfront serve --mode=proxy` on the FULL binary, which must keep the full
 * set. cli/ may not deep-import framework internals, so it writes the name out
 * and tests/unit/build/compile-binary-includes.test.ts asserts the two agree.
 */
export const PROXY_BINARY_PROFILE_GLOBAL = "__VERYFRONT_PROXY_BINARY_PROFILE__";

/**
 * What a compiled binary froze in: every package version it carries, and every
 * import constraint (`2.9.0`, `^2.4.0`, `*`) it can resolve, both by name.
 *
 * The two differ. A compiled binary answers an `npm:` import by looking its
 * constraint up, not by searching the packages it carries, so a package that
 * arrived only transitively -- or a version reached only through `^2.4.0` --
 * is carried but cannot be imported as `npm:<name>@<version>`.
 */
export interface EmbeddedNpmSet {
  packages: Readonly<Record<string, readonly string[]>>;
  constraints: Readonly<Record<string, readonly string[]>>;
}

/**
 * The npm set THIS binary froze in, which is the only set a decision here may
 * be made against.
 */
export function embeddedNpmPackagesForRuntime(): EmbeddedNpmSet {
  return (globalThis as Record<string, unknown>)[PROXY_BINARY_PROFILE_GLOBAL] === true
    ? { packages: PROXY_EMBEDDED_NPM_PACKAGES, constraints: PROXY_EMBEDDED_NPM_CONSTRAINTS }
    : { packages: EMBEDDED_NPM_PACKAGES, constraints: EMBEDDED_NPM_CONSTRAINTS };
}

function ownEntry(
  table: Readonly<Record<string, readonly string[]>>,
  name: string,
): readonly string[] | undefined {
  // The tables are plain objects: `constructor` must not read Object.prototype.
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

function runtimeImport(name: string, constraint: string, subpath: string): ProjectNpmImport {
  const tail = subpath === "." ? "" : subpath.slice(1);
  return { kind: "runtime", specifier: `npm:${name}@${constraint}${tail}` };
}

/**
 * Does a recorded constraint satisfy a requirement (a declaration or the
 * import's own range)? An exact recorded version is checked against the
 * requirement; a recorded range (`*`, `^2.4.0`) resolves to a version this
 * module cannot see, so it satisfies only the identical range.
 */
function constraintSatisfies(constraint: string, requirement: string | undefined | null): boolean {
  if (requirement === undefined || requirement === null) return true;
  if (EXACT_VERSION.test(constraint)) return rangeAdmitsVersion(requirement, constraint) === true;
  return constraint === requirement.trim();
}

/**
 * The recorded constraint to re-emit a pinless import under, or `null` when no
 * recorded constraint satisfies both the declaration and the import's range.
 * Prefers the constraint the import or declaration wrote verbatim, then the
 * highest exact version.
 */
function compatibleEmbeddedConstraint(
  embedded: EmbeddedNpmSet,
  name: string,
  declared: string | undefined,
  importRange: string | null,
): string | null {
  const candidates = (ownEntry(embedded.constraints, name) ?? []).filter((constraint) =>
    constraintSatisfies(constraint, declared) && constraintSatisfies(constraint, importRange)
  );
  if (candidates.length === 0) return null;
  const written = [importRange, declared?.trim()].find((range) =>
    range != null && candidates.includes(range)
  );
  if (written != null) return written;
  const exact = candidates.filter((constraint) => EXACT_VERSION.test(constraint));
  if (exact.length === 0) return candidates.includes("*") ? "*" : candidates[0]!;
  const [first, ...rest] = exact;
  return rest.reduce((best, candidate) =>
    compareVersions(
        { core: coreOf(candidate), pre: prereleaseOf(candidate) },
        { core: coreOf(best), pre: prereleaseOf(best) },
      ) > 0
      ? candidate
      : best, first!);
}

/**
 * The runtime decision for `<name>@<version>` when the binary can resolve that
 * exact constraint, or `null` when it cannot. The import is re-emitted under
 * that constraint: left as written, `import "yaml"` becomes `npm:yaml` -- the
 * constraint `yaml@*` -- which the binary may never have recorded.
 */
function embeddedImport(
  embedded: EmbeddedNpmSet,
  name: string,
  version: string,
  subpath: string,
): ProjectNpmImport | null {
  if (!ownEntry(embedded.constraints, name)?.includes(version)) return null;
  return runtimeImport(name, version, subpath);
}

/**
 * Decide how the discovery bundler should resolve one npm specifier on a
 * compiled runtime, given the project's declared dependency pins.
 *
 * `pins` holds package.json's declarations verbatim, ranges included;
 * {@link exactVersionNamedByRange} reduces each to the one version it names.
 * There is no semver resolver here and deliberately so -- see that function --
 * so every version served below is one the project literally wrote, and every
 * embedded check is against a version the binary actually froze. Implements the module header's
 * precedence 1-6 in that order.
 *
 * An import that names an exact version is served that version when the
 * declaration admits it ({@link rangeAdmitsVersion}), and an import that names
 * a range is refused when the range excludes the declared pin.
 *
 * One consequence worth stating: "satisfied by an embedded version" is read as
 * "the version the declaration NAMES is embedded", not as a semver range test.
 * `npm install` writes `^<the version it just installed>`, so the two agree for
 * the case that matters; where they differ -- `"ajv": "^8.0.0"` against an
 * embedded ajv 8.18.0 -- this inlines 8.0.0 rather than reusing 8.18.0. That is
 * a version the project declared, fetched deterministically, and it is the
 * conservative side of a call that cannot be made without a resolver.
 */
export function classifyProjectNpmImport(
  specifier: string,
  pins: Readonly<Record<string, string>>,
  embedded: EmbeddedNpmSet = embeddedNpmPackagesForRuntime(),
): ProjectNpmImport {
  const parsed = parseNpmSpecifier(specifier);
  if (!parsed) return { kind: "runtime" };
  if (isRuntimeProvidedImport(specifier, parsed.name)) return { kind: "runtime" };
  if (!isContainedSubpath(parsed.subpath)) {
    // The subpath is project text and may carry anything, so it is not echoed.
    return {
      kind: "missing",
      name: parsed.name,
      reason: `the import names a subpath of ${parsed.name} with an empty, \`.\` or ` +
        `\`..\` segment, or an encoded or backslash separator`,
    };
  }

  const declared = Object.hasOwn(pins, parsed.name) ? pins[parsed.name] : undefined;
  const pin = declared === undefined ? null : exactVersionNamedByRange(declared);
  const request = { ...parsed, declared, pin, embedded };
  return parsed.version !== null && EXACT_VERSION.test(parsed.version)
    ? classifyExactImport(request, parsed.version)
    : classifyUnversionedImport(request);
}

/**
 * Is this import one only the runtime may answer? An explicit `npm:` coordinate
 * names the npm package even when it shares a Node builtin's name --
 * `npm:buffer@6.0.3` is the npm `buffer` package, not `node:buffer` -- so only
 * the framework's own packages keep that form on the runtime.
 */
function isRuntimeProvidedImport(specifier: string, name: string): boolean {
  if (!isFrameworkProvidedPackage(name)) return false;
  return !specifier.startsWith("npm:") || nodeBuiltinSpecifier(name) === null;
}

/** The characters of a semver range or a dist-tag, and nothing that can carry a URL. */
const PLAIN_DECLARATION = /^[0-9A-Za-z.*^~<>=|+\s-]*$/;

/**
 * A declaration as user-facing detail may show it. A range or dist-tag is
 * quoted verbatim; anything else -- `git+https://<TOKEN>@host/repo.git`, a
 * `file:` path, a `user/repo` shorthand -- can carry credentials or a machine
 * path, so only its kind is named.
 */
function describeDeclaration(declared: string): string {
  if (PLAIN_DECLARATION.test(declared)) return `"${declared}"`;
  const scheme = URL_SCHEME.exec(declared)?.[0];
  return scheme === undefined ? "a non-registry source" : `a "${scheme}" source`;
}

/** A path segment of a package subpath: nothing that can carry `user:token@host`. */
const PLAIN_SUBPATH = /^\.\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** A percent-encoded `.`, `/` or `\`, which a URL normaliser may decode. */
const ENCODED_PATH_CHARACTER = /%(?:2e|2f|5c)/i;

/**
 * Does this subpath stay inside its package once it is appended to a CDN
 * coordinate? `unpdf/../../left-pad@1.3.0` becomes
 * `https://esm.sh/unpdf@1.8.1/../../left-pad@1.3.0`, which normalises to
 * `left-pad@1.3.0` -- a package nothing declared or checked.
 */
function isContainedSubpath(subpath: string): boolean {
  if (subpath === ".") return true;
  if (subpath.includes("\\") || ENCODED_PATH_CHARACTER.test(subpath)) return false;
  return subpath.slice(2).split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

/** A version written into an import, as user-facing detail may show it. */
function isPlainImportVersion(version: string): boolean {
  return PLAIN_DECLARATION.test(version);
}

/**
 * An import specifier as user-facing detail may show it: the package name, and
 * the version and subpath only when neither can carry a URL or credential.
 * `npm:pkg@https://<TOKEN>@host/x` is shown as the package it names.
 */
export function describeNpmImport(specifier: string): string {
  const parsed = parseNpmSpecifier(specifier);
  if (parsed === null) return "an import that names no npm package";
  const { name, version, subpath } = parsed;
  if (version !== null && !isPlainImportVersion(version)) {
    return `${name} (with a non-registry version)`;
  }
  const shownVersion = version === null ? "" : `@${version}`;
  const shownSubpath = subpath !== "." && PLAIN_SUBPATH.test(subpath) &&
      isContainedSubpath(subpath)
    ? subpath.slice(1)
    : "";
  return `${name}${shownVersion}${shownSubpath}`;
}

/** One import to classify, with what the project declared for its package. */
interface ImportRequest extends ParsedNpmSpecifier {
  declared: string | undefined;
  pin: string | null;
  embedded: EmbeddedNpmSet;
}

/** An import that names one exact version (`npm:unpdf@1.8.1`). */
function classifyExactImport(
  { name, subpath, declared, pin, embedded }: ImportRequest,
  requested: string,
): ProjectNpmImport {
  const admission = declared === undefined ? null : rangeAdmitsVersion(declared, requested);
  const admitted = admission === true;
  // A declaration this module cannot evaluate (`>=4.0.0 <5.0.0`, a dist-tag)
  // is not taken as admitting the import: the embedded copy may be exactly the
  // version it rules out.
  if (declared !== undefined && admission === null && pin === null) {
    return {
      kind: "missing",
      name,
      reason: `the import asks for ${name}@${requested} and package.json declares ` +
        `${describeDeclaration(declared)}, which it cannot be checked against -- declare an ` +
        `exact version`,
    };
  }
  // A version in the specifier that the declaration excludes must not be
  // served, from the pin or from the runtime: the project would run code its
  // own package.json rules out. With a pin, a declaration this module cannot
  // evaluate is not taken as admitting the import either.
  if (admission === false || (pin !== null && !admitted)) {
    return {
      kind: "missing",
      name,
      reason: `the import asks for ${name}@${requested} but package.json declares ` +
        `${name}@${declared}`,
    };
  }
  const inBinary = embeddedImport(embedded, name, requested, subpath);
  if (inBinary !== null) return inBinary;
  // The declaration admits the exact version the import names -- `^1.8.1`
  // admits `npm:unpdf@1.9.0` -- so that version is the one to serve.
  if (admitted) return { kind: "cdn", name, version: requested, subpath };
  // Every declared case has returned above, so the package is undeclared.
  return {
    kind: "missing",
    name,
    reason: `this runtime does not carry ${name}@${requested} and the project declares no ` +
      `dependency on ${name}`,
  };
}

function describeImportedVersion(name: string, version: string): string {
  return isPlainImportVersion(version) ? `${name}@${version}` : `${name} at a non-registry version`;
}

function describeImportedRange(version: string): string {
  return isPlainImportVersion(version) ? `"${version}"` : "it names";
}

/** An import that names no version, or names a range. */
function classifyUnversionedImport(
  { name, version, subpath, declared, pin, embedded }: ImportRequest,
): ProjectNpmImport {
  if (pin !== null) {
    // A range in the import has to admit the declared pin before the pin can
    // serve it: `npm:unpdf@^2` against `"unpdf": "1.8.1"` would run 1.8.1. A
    // range this module cannot evaluate is refused rather than guessed at.
    const admitted = version === null ? true : rangeAdmitsVersion(version, pin);
    if (admitted !== true) {
      return {
        kind: "missing",
        name,
        reason: admitted === false
          ? `the import asks for ${name}@${version} but package.json declares ` +
            `${name}@${declared}`
          : `the import asks for ${describeImportedVersion(name, version!)}, a range that ` +
            `cannot be checked against the declared ${name}@${declared} -- import the ` +
            `declared version instead`,
      };
    }
    // The runtime already carries exactly what the project declared: keep the
    // single in-binary copy rather than fetch a second one.
    const inBinary = embeddedImport(embedded, name, pin, subpath);
    if (inBinary !== null) return inBinary;
    return { kind: "cdn", name, version: pin, subpath };
  }

  // No usable pin. The binary can still serve the import, but only under an
  // import constraint it recorded and that both the declaration and the
  // import's own range admit -- never an unconstrained `npm:<name>`, and never
  // an embedded version the declaration rules out.
  const recorded = compatibleEmbeddedConstraint(embedded, name, declared, version);
  if (recorded !== null) return runtimeImport(name, recorded, subpath);

  if (declared !== undefined) {
    return {
      kind: "missing",
      name,
      reason: `this runtime does not carry ${name} and package.json declares ` +
        `${describeDeclaration(declared)}, ` +
        `which names no single version to fetch -- declare an exact version`,
    };
  }
  return {
    kind: "missing",
    name,
    reason: version === null
      ? `this runtime does not carry ${name} and the project declares no dependency on it`
      : `this runtime does not carry ${name} and the project declares no dependency on it, ` +
        `so the version range ${describeImportedRange(version)} in the import cannot be ` +
        `resolved`,
  };
}
