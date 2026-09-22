/**
 * Classify remote `package.json` drift as a server-written dependency pin set.
 *
 * The platform rewrites a project's `package.json` after it resolves bare or
 * ranged npm declarations: every non-exact declaration is replaced by the exact
 * resolved version and the file is re-serialized. That write is fire-and-forget
 * off the render path, so it lands after the CLI that triggered it has already
 * recorded the pushed content as its sync baseline. The next push then sees a
 * remote digest that no longer matches the baseline and raises a push conflict.
 *
 * The conflict guard itself must stay strict for every other path, so the
 * reconciliation happens here instead: a drift is adopted only when it is
 * provably the platform's own pin write, and anything else is still reported as
 * a conflict.
 *
 * @module cli/commands/push/dependency-pins
 */

import { isExactSemver } from "../../../src/transforms/esm/npm-registry-client.ts";

/** Relative path of the manifest the platform rewrites when it pins versions. */
export const PACKAGE_JSON_PATH = "package.json";

/**
 * Raw declaration maps the API published immediately before a guarded
 * `package.json` mutation. Each entry is one `dependencies` +
 * `devDependencies` merge, in the same devDependencies-take-precedence shape
 * the API parses the file into.
 */
export type DependencyPreimage = Readonly<Record<string, string>>;

/** How a remote `package.json` differs from the local sync baseline. */
export type PackageJsonDriftClassification = "server-pins" | "user-edit";

/** A dependency section of `package.json`. */
export type DependencySection = "dependencies" | "devDependencies";

/**
 * The sections a declaration sat in before and after the platform's write.
 *
 * `applyResolvedPins` in the API does `nextDeps[name] = version` followed by
 * `delete nextDevDeps[name]` for every non-exact declaration it resolves, and
 * `buildPackageJsonContent` writes `dependencies` unconditionally. A ranged
 * devDependency the render resolved therefore comes back as a production
 * dependency, which is a different change from tightening a version: it
 * changes what `npm install --production` installs and what a bundler treats
 * as runtime code.
 */
export interface SectionMove {
  from: DependencySection;
  to: DependencySection;
}

/** One declaration the platform tightened from a range to an exact version. */
export interface AdoptedPin {
  name: string;
  version: string;
  /**
   * True when the declaration exists only on the remote side, i.e. the resolver
   * added a dependency the local manifest never declared.
   *
   * The API's writer does this for any specifier a render resolved that the
   * manifest did not declare (`applyResolvedPins` writes `nextDeps[name]` when
   * `!current`), so it is a legitimate part of a pin write. It is nonetheless a
   * different trust question from tightening a range the user chose: the name
   * and the version are both the server's, and `veryfront dev` installs them.
   * Callers must obtain explicit consent before adopting one.
   */
  added: boolean;
  /**
   * Set when the write also moved the declaration between `dependencies` and
   * `devDependencies`, null when it stayed where the user put it.
   *
   * Like an addition this is not bounded by anything the user wrote, so
   * callers must obtain explicit consent before adopting it, and the notice
   * has to name the move rather than reporting a bare version.
   */
  sectionMove: SectionMove | null;
}

type JsonObject = Record<string, unknown>;

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies"] as const;

function parseJsonObject(content: string): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as JsonObject;
}

/**
 * Read one dependency section. An absent section is an empty map; a section
 * that is not a flat string map makes the whole file unclassifiable.
 */
function parseSection(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const [name, declaration] of Object.entries(value)) {
    if (typeof declaration !== "string") return null;
    entries.push([name, declaration]);
  }
  return Object.fromEntries(entries);
}

/**
 * Both dependency sections, kept apart.
 *
 * The API parses the file into one merged map and the preimages it publishes
 * are in that merged shape, but the file it writes is not: it can move a name
 * from `devDependencies` into `dependencies`. Comparing the merged maps hides
 * exactly that move, so the classification works on the sections and only the
 * preimage proof uses the merged view.
 */
interface DeclarationSections {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

function declarationSections(pkg: JsonObject): DeclarationSections | null {
  const deps = parseSection(pkg.dependencies);
  const devDeps = parseSection(pkg.devDependencies);
  if (!deps || !devDeps) return null;
  return { dependencies: deps, devDependencies: devDeps };
}

/**
 * Merge both sections the way the API does, with devDependencies last so a name
 * declared in both resolves to the devDependencies declaration. This is the
 * shape the published preimages are in.
 */
function mergedDeclarations(sections: DeclarationSections): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(sections.dependencies),
    ...Object.entries(sections.devDependencies),
  ]);
}

/** Deep structural equality over JSON values. Key order is not significant. */
function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => jsonEquals(item, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftObject = left as JsonObject;
  const rightObject = right as JsonObject;
  const leftKeys = Object.keys(leftObject);
  if (leftKeys.length !== Object.keys(rightObject).length) return false;
  // Own-key membership, not sorted-list equality: the key sets match when they
  // are the same size and every left key is present on the right.
  return leftKeys.every((key) =>
    Object.hasOwn(rightObject, key) && jsonEquals(leftObject[key], rightObject[key])
  );
}

/** Everything outside the two dependency sections, which a pin write leaves alone. */
function nonDependencyFields(pkg: JsonObject): JsonObject {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(pkg)) {
    if ((DEPENDENCY_SECTIONS as readonly string[]).includes(key)) continue;
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/**
 * Byte-for-byte reproduction of the serialization the API writes:
 * `JSON.stringify(pkg, null, 2)` plus a trailing newline. A file that does not
 * round-trip through it was formatted by something other than that writer.
 */
function isApiSerialization(pkg: JsonObject, content: string): boolean {
  return `${JSON.stringify(pkg, null, 2)}\n` === content;
}

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
  precision: 1 | 2 | 3;
  prerelease: readonly string[];
}

/**
 * Parse a version-like string while retaining prerelease identifiers for npm's
 * ordering and prerelease admission rules. Build metadata does not affect
 * precedence.
 *
 * This mirrors the platform resolver's own parser so the CLI accepts exactly
 * the versions that resolver would have selected for a declared range.
 */
function parseVersionParts(value: string): VersionParts | null {
  const stripped = value.trim();
  const match =
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
      .exec(
        stripped,
      );
  if (!match || (match[4] !== undefined && match[3] === undefined)) return null;
  const coreParts = [match[1], match[2], match[3]].filter((part): part is string =>
    part !== undefined
  );
  if (coreParts.some((part) => part.length > 1 && part.startsWith("0"))) return null;
  const prereleaseParts = match[4]?.split(".") ?? [];
  if (
    prereleaseParts.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))
  ) {
    return null;
  }
  const parts = [match[1], match[2] ?? "0", match[3] ?? "0"].map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return {
    major: parts[0]!,
    minor: parts[1]!,
    patch: parts[2]!,
    precision: match[3] === undefined ? (match[2] === undefined ? 1 : 2) : 3,
    prerelease: prereleaseParts,
  };
}

function declaredValue(
  section: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  return Object.hasOwn(section, name) ? section[name] : undefined;
}

function normalizeNpmPartialRange(value: string): string {
  let operator = "";
  let body = value.trim();
  for (const candidate of [">=", "<=", ">", "<", "^", "~"]) {
    if (body.startsWith(candidate)) {
      operator = candidate;
      body = body.slice(candidate.length);
      break;
    }
  }
  if (body.startsWith("=")) {
    if (operator !== "") return `${operator}=${body.slice(1)}`;
    body = body.slice(1);
  }
  body = body.trim();
  if (operator === "" && /^(?:[xX*])(?:\.[xX*]){0,2}$/.test(body)) return "*";
  const match = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(body);
  if (!match) return `${operator}${body}`;
  if (match[2] === undefined || /^[xX*]$/.test(match[2])) {
    return `${operator}v${match[1]}`;
  }
  if (match[3] === undefined || /^[xX*]$/.test(match[3])) {
    return `${operator}v${match[1]}.${match[2]}`;
  }
  return `${operator}v${match[1]}.${match[2]}.${match[3]}`;
}

function nextPartialBoundary(base: VersionParts): VersionParts | null {
  if (base.precision === 1 && !Number.isSafeInteger(base.major + 1)) return null;
  if (base.precision === 2 && !Number.isSafeInteger(base.minor + 1)) return null;
  return base.precision === 1
    ? { major: base.major + 1, minor: 0, patch: 0, precision: 3, prerelease: [] }
    : { major: base.major, minor: base.minor + 1, patch: 0, precision: 3, prerelease: [] };
}

function matchesPartialPrefix(version: VersionParts, range: VersionParts): boolean {
  if (range.precision === 1) return version.major === range.major;
  if (range.precision === 2) {
    return version.major === range.major && version.minor === range.minor;
  }
  return compareVersionParts(version, range) === 0;
}

function compareVersionParts(left: VersionParts, right: VersionParts): number {
  for (
    const [leftPart, rightPart] of [
      [left.major, right.major],
      [left.minor, right.minor],
      [left.patch, right.patch],
    ] as const
  ) {
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const normalizedLeft = leftPart.replace(/^0+(?=\d)/, "");
      const normalizedRight = rightPart.replace(/^0+(?=\d)/, "");
      if (normalizedLeft.length !== normalizedRight.length) {
        return normalizedLeft.length < normalizedRight.length ? -1 : 1;
      }
      if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftPart < rightPart) {
      return -1;
    } else if (leftPart > rightPart) {
      return 1;
    }
  }
  return 0;
}

/** npm does not admit a prerelease unless the range names that same base version. */
function allowsPrerelease(version: VersionParts, range: VersionParts): boolean {
  if (version.prerelease.length === 0) return true;
  return range.prerelease.length > 0 && version.major === range.major &&
    version.minor === range.minor && version.patch === range.patch;
}

/**
 * Whether `version` satisfies the single npm range token `range`, using the
 * platform resolver's semantics.
 *
 * Composite ranges (`||`, hyphen ranges, space-separated comparator sets) are
 * rejected rather than approximated: an unrecognised range leaves the drift
 * classified as a user edit, which is the existing conflict behaviour.
 */
function satisfiesDeclaredRange(version: string, range: string): boolean {
  const trimmed = normalizeNpmPartialRange(range);
  if (trimmed === "") return false;
  if (/\s/.test(trimmed) || trimmed.includes("||")) return false;

  const parsed = parseVersionParts(version);
  if (parsed === null) return false;
  if (trimmed === "*" || trimmed === "latest") return parsed.prerelease.length === 0;

  if (trimmed.startsWith("^")) {
    const inner = trimmed.slice(1);
    const dotCount = (inner.match(/\./g) ?? []).length;
    const base = parseVersionParts(inner);
    if (base === null || !allowsPrerelease(parsed, base)) return false;
    if (base.major > 0) {
      return parsed.major === base.major && compareVersionParts(parsed, base) >= 0;
    }
    if (dotCount >= 1 && base.minor > 0) {
      return parsed.major === 0 && parsed.minor === base.minor &&
        compareVersionParts(parsed, base) >= 0;
    }
    if (dotCount >= 2) {
      return parsed.major === base.major && parsed.minor === base.minor &&
        parsed.patch === base.patch && compareVersionParts(parsed, base) >= 0;
    }
    if (dotCount >= 1) {
      return parsed.major === 0 && parsed.minor === 0 &&
        compareVersionParts(parsed, base) >= 0;
    }
    return parsed.major === base.major && compareVersionParts(parsed, base) >= 0;
  }

  if (trimmed.startsWith("~")) {
    const inner = trimmed.slice(1);
    const dotCount = (inner.match(/\./g) ?? []).length;
    const base = parseVersionParts(inner);
    if (base === null || !allowsPrerelease(parsed, base)) return false;
    if (dotCount >= 1) {
      return parsed.major === base.major && parsed.minor === base.minor &&
        compareVersionParts(parsed, base) >= 0;
    }
    return parsed.major === base.major && compareVersionParts(parsed, base) >= 0;
  }

  if (trimmed.startsWith(">=")) {
    const base = parseVersionParts(trimmed.slice(2));
    return base !== null && allowsPrerelease(parsed, base) &&
      compareVersionParts(parsed, base) >= 0;
  }
  if (trimmed.startsWith(">")) {
    const base = parseVersionParts(trimmed.slice(1));
    if (base === null || !allowsPrerelease(parsed, base)) return false;
    if (base.precision === 3) return compareVersionParts(parsed, base) > 0;
    const lower = nextPartialBoundary(base);
    return lower !== null && compareVersionParts(parsed, lower) >= 0;
  }
  if (trimmed.startsWith("<=")) {
    const base = parseVersionParts(trimmed.slice(2));
    if (base === null || !allowsPrerelease(parsed, base)) return false;
    if (base.precision === 3) return compareVersionParts(parsed, base) <= 0;
    const upper = nextPartialBoundary(base);
    return upper !== null && compareVersionParts(parsed, upper) < 0;
  }
  if (trimmed.startsWith("<")) {
    const base = parseVersionParts(trimmed.slice(1));
    return base !== null && allowsPrerelease(parsed, base) && compareVersionParts(parsed, base) < 0;
  }

  const base = parseVersionParts(trimmed);
  return base !== null && allowsPrerelease(parsed, base) && matchesPartialPrefix(parsed, base);
}

/**
 * The declarations that changed, when every change is a pin the platform could
 * have written. Returns null when any change is something else: a removed
 * declaration, an added declaration that is not exact, a tightened declaration
 * whose new value is not an exact version or does not satisfy the old range, or
 * a rewrite of a declaration that was already exact (the resolver never
 * replaces one).
 *
 * The comparison is per section, so a declaration that changed sections is
 * reported as such instead of looking like a plain tightening, and a name
 * declared in both sections is refused outright whenever it is part of the
 * change: the API resolves that name through the devDependencies declaration
 * and writes the result into `dependencies`, which would silently replace an
 * exact version the user pinned in `dependencies`.
 */
function tightenedPins(
  baseline: DeclarationSections,
  remote: DeclarationSections,
): AdoptedPin[] | null {
  const pins: AdoptedPin[] = [];
  const names = new Set([
    ...Object.keys(baseline.dependencies),
    ...Object.keys(baseline.devDependencies),
    ...Object.keys(remote.dependencies),
    ...Object.keys(remote.devDependencies),
  ]);

  for (const name of names) {
    const beforeDep = declaredValue(baseline.dependencies, name);
    const beforeDev = declaredValue(baseline.devDependencies, name);
    const afterDep = declaredValue(remote.dependencies, name);
    const afterDev = declaredValue(remote.devDependencies, name);
    // Untouched in both sections, including a name declared in both and left
    // alone by the write.
    if (beforeDep === afterDep && beforeDev === afterDev) continue;
    // A name this write touched must sit in exactly one section on each side.
    if (beforeDep !== undefined && beforeDev !== undefined) return null;
    if (afterDep !== undefined && afterDev !== undefined) return null;

    const before = beforeDep ?? beforeDev;
    const after = afterDep ?? afterDev;
    if (after === undefined) return null;
    if (!isExactSemver(after)) return null;

    if (before === undefined) {
      pins.push({ name, version: after, added: true, sectionMove: null });
      continue;
    }
    if (isExactSemver(before)) return null;
    if (!satisfiesDeclaredRange(after, before)) return null;

    const from: DependencySection = beforeDep !== undefined ? "dependencies" : "devDependencies";
    const to: DependencySection = afterDep !== undefined ? "dependencies" : "devDependencies";
    pins.push({
      name,
      version: after,
      added: false,
      sectionMove: from === to ? null : { from, to },
    });
  }

  // Stable output for the notice and for the tests that pin it: the order the
  // sections are iterated in is the order the file declares them.
  pins.sort((left, right) => left.name.localeCompare(right.name));
  return pins;
}

function matchesPreimage(
  declarations: Readonly<Record<string, string>>,
  preimages: ReadonlyArray<DependencyPreimage>,
): boolean {
  return preimages.some((preimage) => jsonEquals(preimage, declarations));
}

interface ClassifiedDrift {
  classification: PackageJsonDriftClassification;
  pins: AdoptedPin[];
}

function classify(
  baselineContent: string,
  remoteContent: string,
  preimages: ReadonlyArray<DependencyPreimage>,
): ClassifiedDrift {
  const userEdit: ClassifiedDrift = { classification: "user-edit", pins: [] };

  const baselinePkg = parseJsonObject(baselineContent);
  const remotePkg = parseJsonObject(remoteContent);
  if (!baselinePkg || !remotePkg) return userEdit;

  // Nothing outside the dependency sections may move.
  if (!jsonEquals(nonDependencyFields(baselinePkg), nonDependencyFields(remotePkg))) {
    return userEdit;
  }
  // The remote bytes must be what the API's writer would have produced.
  if (!isApiSerialization(remotePkg, remoteContent)) return userEdit;

  const baselineSections = declarationSections(baselinePkg);
  const remoteSections = declarationSections(remotePkg);
  if (!baselineSections || !remoteSections) return userEdit;

  const pins = tightenedPins(baselineSections, remoteSections);
  // A drift with no tightened declaration is a reformat or a key reorder, not a
  // pin write, and adopting it would silently discard a local edit.
  if (!pins || pins.length === 0) return userEdit;

  // Proof that the API, not a person, produced this write: it publishes the
  // declaration map it read and the one it is about to write before mutating
  // the file, so both sides of an adopted drift must appear in that history.
  if (!matchesPreimage(mergedDeclarations(baselineSections), preimages)) return userEdit;
  if (!matchesPreimage(mergedDeclarations(remoteSections), preimages)) return userEdit;

  return { classification: "server-pins", pins };
}

/**
 * Decide whether the remote `package.json` drifted away from the sync baseline
 * because the platform pinned resolved dependency versions into it.
 *
 * @param baselineContent The content this directory last pushed.
 * @param remoteContent The content the project now holds.
 * @param preimages Declaration maps the API published before its guarded writes.
 */
export function classifyPackageJsonDrift(
  baselineContent: string,
  remoteContent: string,
  preimages: ReadonlyArray<DependencyPreimage>,
): PackageJsonDriftClassification {
  return classify(baselineContent, remoteContent, preimages).classification;
}

/**
 * The pins a `"server-pins"` drift adopts, for the notice the push prints.
 * Empty for any drift that is not a server pin write.
 */
export function adoptedPackageJsonPins(
  baselineContent: string,
  remoteContent: string,
  preimages: ReadonlyArray<DependencyPreimage>,
): AdoptedPin[] {
  const result = classify(baselineContent, remoteContent, preimages);
  return result.classification === "server-pins" ? result.pins : [];
}

/**
 * Human-readable summary of adopted pins, e.g.
 * `react 19.3.0, clsx 2.1.1 (added), zod 3.25.7 (moved from devDependencies to
 * dependencies)`.
 *
 * A bare `name version` would describe a section move as if it were an
 * ordinary tightening, which is the one thing the reader has to be told: the
 * declaration they put in `devDependencies` is now a production dependency.
 */
export function formatAdoptedPins(pins: readonly AdoptedPin[]): string {
  return pins.map((pin) => {
    const pinned = `${pin.name} ${pin.version}`;
    if (pin.added) return `${pinned} (added)`;
    if (pin.sectionMove) {
      return `${pinned} (moved from ${pin.sectionMove.from} to ${pin.sectionMove.to})`;
    }
    return pinned;
  }).join(", ");
}

/**
 * The pins that change more than a version, so that adopting them without
 * asking would make a decision on the user's behalf.
 *
 * An addition is not bounded by anything the user wrote: tightening
 * `"react": "^19.2.4"` to `19.3.0` stays inside a range they chose, but the
 * name and the version of an addition are both the server's, and the next
 * `veryfront dev` installs them. Anyone with `project.files.write` can seed
 * both halves of the preimage proof by writing the remote manifest and
 * triggering a resolve, so the proof shows the API's writer produced the
 * bytes, not that the user wanted them.
 *
 * The second kind is a declaration the write moved between `dependencies` and
 * `devDependencies`. The move is not a
 * reporting detail: `applyResolvedPins` promotes every non-exact declaration it
 * resolves into `dependencies`, so a dev-only package silently becomes a
 * production dependency in the user's tracked manifest, changing what
 * `npm install --production` installs and what a bundler pulls into the
 * runtime graph. The preimage proof cannot rule it in, because the preimages
 * are the API's merged declaration map and the merge has already erased which
 * section each name came from.
 */
export function pinsRequiringConsent(pins: readonly AdoptedPin[]): AdoptedPin[] {
  return pins.filter((pin) => pin.added || pin.sectionMove !== null);
}
