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
 * Merge both sections the way the API does, with devDependencies last so a name
 * declared in both resolves to the devDependencies declaration.
 */
function mergedDeclarations(pkg: JsonObject): Record<string, string> | null {
  const deps = parseSection(pkg.dependencies);
  const devDeps = parseSection(pkg.devDependencies);
  if (!deps || !devDeps) return null;
  return Object.fromEntries([...Object.entries(deps), ...Object.entries(devDeps)]);
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
  const leftKeys = Object.keys(left as JsonObject).sort();
  const rightKeys = Object.keys(right as JsonObject).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => jsonEquals((left as JsonObject)[key], (right as JsonObject)[key]));
}

/** Everything outside the two dependency sections, which a pin write leaves alone. */
function nonDependencyFields(pkg: JsonObject): JsonObject {
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(pkg)) {
    if ((DEPENDENCY_SECTIONS as readonly string[]).includes(key)) continue;
    rest[key] = value;
  }
  return rest;
}

/**
 * Byte-for-byte reproduction of the serialization the API writes:
 * `JSON.stringify(pkg, null, 2)` plus a trailing newline. A file that does not
 * round-trip through it was formatted by something other than that writer.
 */
function isApiSerialization(pkg: JsonObject, content: string): boolean {
  return `${JSON.stringify(pkg, null, 2)}\n` === content;
}

type VersionParts = [number, number, number];

/**
 * Parse a version-like string into a `[major, minor, patch]` tuple, dropping a
 * leading range operator and any pre-release or build suffix.
 *
 * This mirrors the platform resolver's own parser so the CLI accepts exactly
 * the versions that resolver would have selected for a declared range.
 */
function parseVersionParts(value: string): VersionParts {
  const stripped = value.replace(/^\s*[~^>=<]+\s*/, "").split("-")[0] ?? "";
  const parts = stripped.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareVersionParts(left: VersionParts, right: VersionParts): number {
  for (
    const [leftPart, rightPart] of [
      [left[0], right[0]],
      [left[1], right[1]],
      [left[2], right[2]],
    ] as const
  ) {
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
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
  const trimmed = range.trim();
  if (trimmed === "") return false;
  if (/\s/.test(trimmed) || trimmed.includes("||")) return false;
  if (trimmed === "*" || trimmed === "latest") return true;

  const parsed = parseVersionParts(version);

  if (trimmed.startsWith("^")) {
    const inner = trimmed.slice(1);
    const dotCount = (inner.match(/\./g) ?? []).length;
    const base = parseVersionParts(inner);
    if (base[0] > 0) return parsed[0] === base[0] && compareVersionParts(parsed, base) >= 0;
    if (dotCount >= 1 && base[1] > 0) {
      return parsed[0] === 0 && parsed[1] === base[1] && compareVersionParts(parsed, base) >= 0;
    }
    if (dotCount >= 2) {
      return parsed[0] === base[0] && parsed[1] === base[1] && parsed[2] === base[2];
    }
    return parsed[0] === base[0] && compareVersionParts(parsed, base) >= 0;
  }

  if (trimmed.startsWith("~")) {
    const inner = trimmed.slice(1);
    const dotCount = (inner.match(/\./g) ?? []).length;
    const base = parseVersionParts(inner);
    if (dotCount >= 1) {
      return parsed[0] === base[0] && parsed[1] === base[1] && parsed[2] >= base[2];
    }
    return parsed[0] === base[0] && compareVersionParts(parsed, base) >= 0;
  }

  if (trimmed.startsWith(">=")) {
    return compareVersionParts(parsed, parseVersionParts(trimmed.slice(2))) >= 0;
  }
  if (trimmed.startsWith(">")) {
    return compareVersionParts(parsed, parseVersionParts(trimmed.slice(1))) > 0;
  }
  if (trimmed.startsWith("<=")) {
    return compareVersionParts(parsed, parseVersionParts(trimmed.slice(2))) <= 0;
  }
  if (trimmed.startsWith("<")) {
    return compareVersionParts(parsed, parseVersionParts(trimmed.slice(1))) < 0;
  }

  return compareVersionParts(parsed, parseVersionParts(trimmed)) === 0;
}

/**
 * The declarations that changed, when every change is a pin the platform could
 * have written. Returns null when any change is something else: a removed
 * declaration, an added declaration that is not exact, a tightened declaration
 * whose new value is not an exact version or does not satisfy the old range, or
 * a rewrite of a declaration that was already exact (the resolver never
 * replaces one).
 */
function tightenedPins(
  baseline: Readonly<Record<string, string>>,
  remote: Readonly<Record<string, string>>,
): AdoptedPin[] | null {
  const pins: AdoptedPin[] = [];

  for (const [name, declaration] of Object.entries(baseline)) {
    const next = remote[name];
    if (next === undefined) return null;
    if (next === declaration) continue;
    if (isExactSemver(declaration)) return null;
    if (!isExactSemver(next)) return null;
    if (!satisfiesDeclaredRange(next, declaration)) return null;
    pins.push({ name, version: next, added: false });
  }

  for (const [name, declaration] of Object.entries(remote)) {
    if (Object.hasOwn(baseline, name)) continue;
    if (!isExactSemver(declaration)) return null;
    pins.push({ name, version: declaration, added: true });
  }

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

  const baselineDeclarations = mergedDeclarations(baselinePkg);
  const remoteDeclarations = mergedDeclarations(remotePkg);
  if (!baselineDeclarations || !remoteDeclarations) return userEdit;

  const pins = tightenedPins(baselineDeclarations, remoteDeclarations);
  // A drift with no tightened declaration is a reformat or a key reorder, not a
  // pin write, and adopting it would silently discard a local edit.
  if (!pins || pins.length === 0) return userEdit;

  // Proof that the API, not a person, produced this write: it publishes the
  // declaration map it read and the one it is about to write before mutating
  // the file, so both sides of an adopted drift must appear in that history.
  if (!matchesPreimage(baselineDeclarations, preimages)) return userEdit;
  if (!matchesPreimage(remoteDeclarations, preimages)) return userEdit;

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

/** Human-readable summary of adopted pins, e.g. `react 19.3.0, zod 3.25.1`. */
export function formatAdoptedPins(pins: readonly AdoptedPin[]): string {
  return pins.map((pin) => `${pin.name} ${pin.version}`).join(", ");
}

/**
 * The pins that introduce a declaration the local manifest never had.
 *
 * Tightening `"react": "^19.2.4"` to `19.3.0` stays inside a range the user
 * already chose, so the preimage proof is enough to adopt it. An addition is
 * not bounded by anything the user wrote: the package name and the version are
 * both chosen remotely, and the next `veryfront dev` installs them. Anyone with
 * `project.files.write` can seed both halves of the preimage proof by writing
 * the manifest and triggering a resolve, so additions need consent from the
 * person whose checkout is about to receive them.
 */
export function addedDeclarationPins(pins: readonly AdoptedPin[]): AdoptedPin[] {
  return pins.filter((pin) => pin.added);
}
