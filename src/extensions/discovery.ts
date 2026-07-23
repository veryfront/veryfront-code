/**
 * Multi-source extension discovery.
 *
 * Discovers extensions from four sources with priority:
 *   config > package > project > local-file
 *
 * @module extensions/discovery
 */

import { join } from "@std/path";
import type {
  Capability,
  ExtensionContractMetadata,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";
import {
  hasControlCharacters,
  identifierIssue,
  MAX_CAPABILITY_TYPE_LENGTH,
  MAX_CONTRACT_NAME_LENGTH,
  MAX_EXTENSION_NAME_LENGTH,
} from "./identifiers.ts";
import { EXTENSION_VALIDATION_ERROR, isVeryfrontErrorWithSlug } from "./errors.ts";
import { snapshotResolvedExtensions } from "./extension-snapshot.ts";
import { validateExtension } from "./validation.ts";

const MAX_PACKAGE_JSON_BYTES = 1_048_576;
const MAX_METADATA_ENTRIES = 128;
const MAX_METADATA_DEPTH = 16;
const MAX_METADATA_NODES = 2_048;
const MAX_METADATA_STRING_CHARACTERS = 1_048_576;
const MAX_MERGE_EXTENSIONS = 4_096;
const MAX_DISCOVERY_DIRECTORY_ENTRIES = 16_384;
const MAX_DISCOVERY_PATH_LENGTH = 4_096;

function assertDiscoveryBaseDir(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_DISCOVERY_PATH_LENGTH || hasControlCharacters(value)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension discovery base directory is invalid",
    });
  }
}

function pushDiscoveredExtension<T>(results: T[], value: T): void {
  if (results.length >= MAX_MERGE_EXTENSIONS) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension discovery must return at most ${MAX_MERGE_EXTENSIONS} extensions`,
    });
  }
  results.push(value);
}

/**
 * Metadata extracted from a package.json that declares itself
 * as a veryfront extension.
 */
export interface PackageMetadata {
  /** Confirms that the package opts into the Veryfront extension contract. */
  isExtension: true;
  /** Capabilities declared by the package. */
  capabilities: Capability[];
  /** Static contract declarations supplied by the package. */
  contracts?: ExtensionContractMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function isCapability(value: unknown): value is Capability {
  if (!isRecord(value)) return false;
  try {
    return identifierIssue(Reflect.get(value, "type"), MAX_CAPABILITY_TYPE_LENGTH) === undefined;
  } catch {
    return false;
  }
}

function snapshotMetadataValue(value: unknown): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  let stringCharacters = 0;

  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > MAX_METADATA_NODES || depth > MAX_METADATA_DEPTH) throw new TypeError();
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError();
      return current;
    }
    if (typeof current === "string") {
      stringCharacters += current.length;
      if (stringCharacters > MAX_METADATA_STRING_CHARACTERS) throw new TypeError();
      return current;
    }
    if (typeof current !== "object" || active.has(current)) throw new TypeError();

    active.add(current);
    try {
      if (Array.isArray(current)) {
        const length = Reflect.get(current, "length");
        if (
          typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
          length > MAX_METADATA_ENTRIES
        ) throw new TypeError();
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          result.push(visit(Reflect.get(current, index), depth + 1));
        }
        return result;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
      const keys = Object.keys(current);
      if (keys.length > MAX_METADATA_ENTRIES) throw new TypeError();
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        stringCharacters += key.length;
        if (stringCharacters > MAX_METADATA_STRING_CHARACTERS) throw new TypeError();
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: visit(Reflect.get(current, key), depth + 1),
          writable: true,
        });
      }
      return result;
    } finally {
      active.delete(current);
    }
  };

  return visit(value, 0);
}

function parseStringList(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Reflect.get(value, "length");
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_METADATA_ENTRIES
    ) return undefined;
    const entries: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < length; index++) {
      const entry = Reflect.get(value, index);
      if (
        identifierIssue(entry, MAX_CONTRACT_NAME_LENGTH) === undefined &&
        !seen.has(entry as string)
      ) {
        seen.add(entry as string);
        entries.push(entry as string);
      }
    }
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function parseCapabilities(value: unknown): Capability[] {
  try {
    if (!Array.isArray(value)) return [];
    const length = Reflect.get(value, "length");
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_METADATA_ENTRIES
    ) return [];
    const capabilities: Capability[] = [];
    for (let index = 0; index < length; index++) {
      const capability = Reflect.get(value, index);
      if (!isCapability(capability)) continue;
      try {
        const snapshot = snapshotMetadataValue(capability);
        if (isCapability(snapshot)) capabilities.push(snapshot);
      } catch {
        // One malformed capability does not invalidate independent entries.
      }
    }
    return capabilities;
  } catch {
    return [];
  }
}

function parseContractMetadata(value: unknown): ExtensionContractMetadata | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const raw = value as Record<string, unknown>;
    const contracts: ExtensionContractMetadata = {};
    const provides = parseStringList(Reflect.get(raw, "provides"));
    const requires = parseStringList(Reflect.get(raw, "requires"));
    if (provides) contracts.provides = provides;
    if (requires) contracts.requires = requires;
    return provides || requires ? contracts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse veryfront extension metadata from a package.json-like object.
 *
 * Returns `PackageMetadata` when the package declares
 * `veryfront.extension: true`, otherwise `undefined`. Malformed capability
 * entries are filtered out; the caller receives only valid shapes.
 */
export function parsePackageMetadata(
  pkg: unknown,
): PackageMetadata | undefined {
  if (!isRecord(pkg)) return undefined;

  let vf: unknown;
  try {
    vf = Reflect.get(pkg, "veryfront");
  } catch {
    return undefined;
  }
  if (!isRecord(vf)) return undefined;

  let extension: unknown;
  let rawCapabilities: unknown;
  let rawContracts: unknown;
  try {
    extension = Reflect.get(vf, "extension");
    rawCapabilities = Reflect.get(vf, "capabilities");
    rawContracts = Reflect.get(vf, "contracts");
  } catch {
    return undefined;
  }
  if (extension !== true) {
    return undefined;
  }

  const capabilities = parseCapabilities(rawCapabilities);
  const contracts = parseContractMetadata(rawContracts);

  return contracts
    ? { isExtension: true, capabilities, contracts }
    : { isExtension: true, capabilities };
}

/**
 * Merge extensions from all four sources in priority order.
 *
 * Priority (highest first): config > package > project > local-file.
 * Duplicates are resolved by keeping the highest-priority entry.
 * Disable directives (`{ name, enabled: false }`) remove matching
 * extensions regardless of source.
 */
export function mergeExtensions(
  config: ResolvedExtension[],
  packages: ResolvedExtension[],
  project: ResolvedExtension[],
  local: ResolvedExtension[],
  disableDirectives?: Array<{ name: string; enabled: false }>,
  builtin?: ResolvedExtension[],
): ResolvedExtension[] {
  let mergeEntryCount = 0;
  const snapshotLane = (value: unknown, label: string): ResolvedExtension[] => {
    const entries = snapshotMergeLane(value, label);
    mergeEntryCount += entries.length;
    if (mergeEntryCount > MAX_MERGE_EXTENSIONS) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Merged extension sources must contain at most ${MAX_MERGE_EXTENSIONS} entries`,
      });
    }
    return entries;
  };

  const configSnapshots = snapshotLane(config, "Config");
  const packageSnapshots = snapshotLane(packages, "Package");
  const projectSnapshots = snapshotLane(project, "Project");
  const localSnapshots = snapshotLane(local, "Local");
  const builtinSnapshots = builtin === undefined ? [] : snapshotLane(builtin, "Builtin");
  const configEntries = validateMergeLane(configSnapshots, "Config", "config");
  const packageEntries = validateMergeLane(packageSnapshots, "Package", "package");
  const projectEntries = validateMergeLane(projectSnapshots, "Project", "project");
  const localEntries = validateMergeLane(localSnapshots, "Local", "local-file");
  const builtinEntries = validateMergeLane(builtinSnapshots, "Builtin", "builtin");
  const safeDisableDirectives = readDisableDirectives(disableDirectives);
  const disabledNames = new Set(
    safeDisableDirectives.map((directive) => directive.name),
  );

  const seen = new Map<string, ResolvedExtension>();

  // Process sources in priority order -- first write wins.
  // Builtin extensions have the lowest priority so project/package/config
  // extensions can override them.
  const ordered: ResolvedExtension[] = [
    ...configEntries,
    ...packageEntries,
    ...projectEntries,
    ...localEntries,
    ...builtinEntries,
  ];

  for (const resolved of ordered) {
    const name = resolved.extension.name;
    if (disabledNames.has(name)) continue;
    if (!seen.has(name)) {
      seen.set(name, resolved);
    }
  }

  return [...seen.values()];
}

function snapshotMergeLane(value: unknown, label: string): ResolvedExtension[] {
  try {
    return snapshotResolvedExtensions(value);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `${label} extension entries are invalid`,
    });
  }
}

function validateMergeLane(
  snapshots: ResolvedExtension[],
  label: string,
  expectedSource: ExtensionSource,
): ResolvedExtension[] {
  const entries: ResolvedExtension[] = [];
  for (let index = 0; index < snapshots.length; index++) {
    let entry: unknown;
    let extension: unknown;
    let origin: unknown;
    let source: unknown;
    try {
      entry = snapshots[index];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError();
      }
      extension = Reflect.get(entry, "extension");
      origin = Reflect.get(entry, "origin");
      source = Reflect.get(entry, "source");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `${label} extension entry is invalid`,
      });
    }
    if (
      source !== expectedSource || typeof origin !== "string" || origin.length === 0 ||
      origin.length > 4_096 || hasControlCharacters(origin) ||
      validateExtension(extension).length > 0
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `${label} extension entry is invalid`,
      });
    }
    entries.push(entry as ResolvedExtension);
  }
  return entries;
}

function readDisableDirectives(
  value: unknown,
): Array<{ name: string; enabled: false }> {
  if (value === undefined) return [];
  let length: unknown;
  try {
    if (!Array.isArray(value)) throw new TypeError();
    length = Reflect.get(value, "length");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Disable directives are invalid" });
  }
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_MERGE_EXTENSIONS
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Disable directives are invalid" });
  }
  const directives: Array<{ name: string; enabled: false }> = [];
  for (let index = 0; index < length; index++) {
    let entry: unknown;
    let enabled: unknown;
    let name: unknown;
    try {
      entry = Reflect.get(value, index);
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError();
      }
      enabled = Reflect.get(entry, "enabled");
      name = Reflect.get(entry, "name");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Disable directive is invalid" });
    }
    if (enabled !== false || identifierIssue(name, MAX_EXTENSION_NAME_LENGTH) !== undefined) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Disable directive is invalid" });
    }
    directives.push({ name: name as string, enabled: false });
  }
  return directives;
}

// ---------------------------------------------------------------------------
// Filesystem discovery helpers
// ---------------------------------------------------------------------------

async function readDir(path: string): Promise<Deno.DirEntry[]> {
  try {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(path)) {
      if (entries.length >= MAX_DISCOVERY_DIRECTORY_ENTRIES) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message:
            `Extension discovery directories must contain at most ${MAX_DISCOVERY_DIRECTORY_ENTRIES} entries`,
        });
      }
      entries.push(entry);
    }
    return entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    if (isVeryfrontErrorWithSlug(err, "extension-validation")) throw err;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension discovery could not read a directory",
    });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension discovery could not inspect a file",
    });
  }
}

async function directoryExists(path: string, entry: Deno.DirEntry): Promise<boolean> {
  if (entry.isDirectory) return true;
  if (!entry.isSymlink) return false;
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension discovery could not inspect a directory",
    });
  }
}

/**
 * Scan `node_modules` (including `@scoped` packages) for packages
 * that declare veryfront extension metadata in their `package.json`.
 */
export async function discoverPackageExtensions(
  baseDir: string,
): Promise<Array<{ packageName: string; metadata: PackageMetadata }>> {
  assertDiscoveryBaseDir(baseDir);
  const nmDir = join(baseDir, "node_modules");
  const results: Array<{ packageName: string; metadata: PackageMetadata }> = [];
  const entries = await readDir(nmDir);

  for (const entry of entries) {
    const entryPath = join(nmDir, entry.name);
    if (!await directoryExists(entryPath, entry)) continue;

    if (entry.name.startsWith("@")) {
      // Scoped packages -- iterate one level deeper.
      const scopeDir = entryPath;
      const scopeEntries = await readDir(scopeDir);
      for (const scopeEntry of scopeEntries) {
        if (!await directoryExists(join(scopeDir, scopeEntry.name), scopeEntry)) continue;
        const pkgName = `${entry.name}/${scopeEntry.name}`;
        const meta = await tryReadPackageMeta(
          join(scopeDir, scopeEntry.name),
        );
        if (meta) pushDiscoveredExtension(results, { packageName: pkgName, metadata: meta });
      }
    } else {
      const meta = await tryReadPackageMeta(join(nmDir, entry.name));
      if (meta) pushDiscoveredExtension(results, { packageName: entry.name, metadata: meta });
    }
  }

  return results;
}

async function tryReadPackageMeta(
  pkgDir: string,
): Promise<PackageMetadata | undefined> {
  const packageJsonPath = join(pkgDir, "package.json");
  let raw: string;
  try {
    const info = await Deno.stat(packageJsonPath);
    if (!info.isFile || info.size > MAX_PACKAGE_JSON_BYTES) return undefined;
    raw = await Deno.readTextFile(packageJsonPath);
    if (raw.length > MAX_PACKAGE_JSON_BYTES) return undefined;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension discovery could not read package metadata",
    });
  }
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return parsePackageMetadata(pkg);
  } catch {
    // Malformed JSON -- treat as non-extension package.
    return undefined;
  }
}

/**
 * Discover project extensions living under `extensions/` in the project root.
 *
 * Looks for `extensions/<name>/src/index.ts` and `extensions/<name>/index.ts`.
 */
export async function discoverProjectExtensions(
  baseDir: string,
): Promise<string[]> {
  assertDiscoveryBaseDir(baseDir);
  const extDir = join(baseDir, "extensions");
  const entries = await readDir(extDir);
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const srcIndex = join(extDir, entry.name, "src", "index.ts");
    const rootIndex = join(extDir, entry.name, "index.ts");

    if (await fileExists(srcIndex)) {
      pushDiscoveredExtension(results, srcIndex);
    } else if (await fileExists(rootIndex)) {
      pushDiscoveredExtension(results, rootIndex);
    }
  }

  return results;
}

/**
 * Find `*.extension.ts` files in the project root.
 */
export async function discoverLocalExtensions(
  baseDir: string,
): Promise<string[]> {
  assertDiscoveryBaseDir(baseDir);
  const entries = await readDir(baseDir);
  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".extension.ts")) continue;
    const path = join(baseDir, entry.name);
    if (await fileExists(path)) pushDiscoveredExtension(results, path);
  }
  return results;
}
