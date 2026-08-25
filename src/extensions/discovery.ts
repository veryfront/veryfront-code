/**
 * Multi-source extension discovery.
 *
 * Discovers extensions from four sources with priority:
 *   config > package > project > local-file
 *
 * @module extensions/discovery
 */

import { join } from "#veryfront/compat/path";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  bindExtensionEntrypoint,
  type BoundExtensionEntrypoint,
  captureExtensionOwner,
  ExtensionEntrypointIdentityError,
  selectPackageImportEntrypoint,
} from "./entrypoint-identity.ts";
import { quoteDiagnosticString } from "./diagnostic-string.ts";
import { type ExtensionManifestSyntax, readExtensionManifest } from "./manifest-reader.ts";
import type { Capability, PackageContractMetadata, ResolvedExtension } from "./types.ts";

/**
 * Metadata extracted from a package.json that declares itself
 * as a veryfront extension.
 */
export interface PackageMetadata {
  isExtension: true;
  /**
   * Whether discovery may activate the extension without project config.
   * Absence is the documented legacy equivalent of `"auto"`.
   */
  activation?: ExtensionActivationMode;
  capabilities: Capability[];
  contracts?: PackageContractMetadata;
}

/** Controls whether installation alone may activate an extension package. */
export type ExtensionActivationMode = "auto" | "explicit";

/** A package extension whose manifest is bound to one physical import target. */
export interface DiscoveredPackageExtension {
  packageName: string;
  importTarget: string;
  metadata: PackageMetadata;
}

/** @internal Package discovery result retaining volatile filesystem identity. */
export interface BoundDiscoveredPackageExtension extends DiscoveredPackageExtension {
  binding: BoundExtensionEntrypoint;
}

/** @internal Project discovery result retaining volatile filesystem identity. */
export interface BoundDiscoveredProjectExtension {
  extensionName: string;
  binding: BoundExtensionEntrypoint;
}

const MISSING_METADATA_PROPERTY = Symbol("missing-extension-metadata-property");
const INVALID_METADATA_PROPERTY = Symbol("invalid-extension-metadata-property");
const MAX_EXTENSION_METADATA_ENTRIES = 1_024;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const isSafeInteger = Number.isSafeInteger;

function readOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown | typeof MISSING_METADATA_PROPERTY | typeof INVALID_METADATA_PROPERTY {
  if (!value || typeof value !== "object") return INVALID_METADATA_PROPERTY;
  try {
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (!descriptor) return MISSING_METADATA_PROPERTY;
    return !descriptor.enumerable || !hasOwn(descriptor, "value")
      ? INVALID_METADATA_PROPERTY
      : descriptor.value;
  } catch {
    return INVALID_METADATA_PROPERTY;
  }
}

function readArrayDataValues(value: unknown): unknown[] | undefined {
  let arrayValue: boolean;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    arrayValue = isArray(value);
    lengthDescriptor = arrayValue ? getOwnPropertyDescriptor(value, "length") : undefined;
  } catch {
    return undefined;
  }
  const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (
    !arrayValue || !isSafeInteger(length) || length < 0 ||
    length > MAX_EXTENSION_METADATA_ENTRIES
  ) return undefined;

  const entries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const entry = readOwnDataProperty(value, String(index));
    if (entry !== MISSING_METADATA_PROPERTY && entry !== INVALID_METADATA_PROPERTY) {
      entries.push(entry);
    }
  }
  return entries;
}

function isCapability(value: unknown): value is Capability {
  let arrayValue: boolean;
  try {
    arrayValue = isArray(value);
  } catch {
    return false;
  }
  if (value === null || typeof value !== "object" || arrayValue) return false;
  const type = readOwnDataProperty(value, "type");
  return typeof type === "string" && type.length > 0;
}

function parseStringList(value: unknown): string[] | undefined {
  const values = readArrayDataValues(value);
  if (!values) return undefined;
  const entries = values.filter((entry): entry is string =>
    typeof entry === "string" && entry.length > 0
  );
  return entries.length > 0 ? entries : undefined;
}

function parseContractMetadata(value: unknown): PackageContractMetadata | undefined {
  let arrayValue: boolean;
  try {
    arrayValue = isArray(value);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || arrayValue) return undefined;
  const contracts: PackageContractMetadata = {};
  const provides = parseStringList(readOwnDataProperty(value, "provides"));
  const requires = parseStringList(readOwnDataProperty(value, "requires"));
  if (provides) contracts.provides = provides;
  if (requires) contracts.requires = requires;
  return provides || requires ? contracts : undefined;
}

function readActivationMode(
  metadata: unknown,
):
  | ExtensionActivationMode
  | typeof MISSING_METADATA_PROPERTY
  | typeof INVALID_METADATA_PROPERTY {
  const activation = readOwnDataProperty(metadata, "activation");
  if (activation === MISSING_METADATA_PROPERTY) return activation;
  return activation === "auto" || activation === "explicit"
    ? activation
    : INVALID_METADATA_PROPERTY;
}

function quotedPath(path: string): string {
  return quoteDiagnosticString(path);
}

/**
 * Resolve package activation without invoking an accessor on an ordinary data
 * object. Missing activation preserves legacy automatic discovery; malformed
 * live values fail closed as explicit-only. Injected discovery implementations
 * are trusted test seams and must not supply Proxies, whose descriptor traps
 * cannot be detected portably without invoking them.
 */
export function resolvePackageActivation(
  metadata: PackageMetadata,
): ExtensionActivationMode {
  const activation = readActivationMode(metadata);
  return activation === MISSING_METADATA_PROPERTY || activation === "auto" ? "auto" : "explicit";
}

/**
 * Parse veryfront extension metadata from a package.json-like object.
 *
 * Returns `PackageMetadata` when the package declares
 * `veryfront.extension: true`, otherwise `undefined`. Malformed capability
 * entries are filtered out; the caller receives only valid shapes.
 */
export function parsePackageMetadata(
  pkg: Record<string, unknown>,
): PackageMetadata | undefined {
  const vf = readOwnDataProperty(pkg, "veryfront");
  let arrayValue: boolean;
  try {
    arrayValue = isArray(vf);
  } catch {
    return undefined;
  }
  if (vf === null || typeof vf !== "object" || arrayValue) return undefined;

  const meta = vf as Record<string, unknown>;
  if (readOwnDataProperty(meta, "extension") !== true) {
    return undefined;
  }
  const activation = readActivationMode(meta);
  if (activation === INVALID_METADATA_PROPERTY) return undefined;

  const capabilities = (readArrayDataValues(readOwnDataProperty(meta, "capabilities")) ?? [])
    .filter(isCapability);
  const contracts = parseContractMetadata(readOwnDataProperty(meta, "contracts"));

  const parsed: PackageMetadata = contracts
    ? { isExtension: true, capabilities, contracts }
    : { isExtension: true, capabilities };
  if (activation !== MISSING_METADATA_PROPERTY) {
    parsed.activation = activation;
  }
  return parsed;
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
  const disabledNames = new Set(
    (disableDirectives ?? []).map((d) => d.name),
  );

  const seen = new Map<string, ResolvedExtension>();

  // Process sources in priority order -- first write wins.
  // Builtin extensions have the lowest priority so project/package/config
  // extensions can override them.
  const ordered: ResolvedExtension[] = [
    ...config,
    ...packages,
    ...project,
    ...local,
    ...(builtin ?? []),
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

// ---------------------------------------------------------------------------
// Filesystem discovery helpers
// ---------------------------------------------------------------------------

async function readDir(path: string): Promise<Deno.DirEntry[]> {
  try {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(path)) {
      entries.push(entry);
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return entries;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}

async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

function projectManifestActivation(
  manifest: unknown,
  manifestPath: string,
): ExtensionActivationMode {
  if (!manifest || typeof manifest !== "object" || isArray(manifest)) {
    throw new TypeError(
      `Project extension manifest ${quotedPath(manifestPath)} must be an object`,
    );
  }

  const veryfront = readOwnDataProperty(manifest, "veryfront");
  if (veryfront === MISSING_METADATA_PROPERTY) return "auto";
  if (
    veryfront === INVALID_METADATA_PROPERTY || !veryfront ||
    typeof veryfront !== "object" || isArray(veryfront)
  ) {
    throw new TypeError(
      `Project extension manifest ${
        quotedPath(manifestPath)
      } has invalid veryfront metadata; expected an object`,
    );
  }

  const activation = readActivationMode(veryfront as Record<string, unknown>);
  if (activation === INVALID_METADATA_PROPERTY) {
    throw new TypeError(
      `Project extension manifest ${
        quotedPath(manifestPath)
      } has an invalid veryfront.activation mode`,
    );
  }
  return activation === MISSING_METADATA_PROPERTY ? "auto" : activation;
}

/**
 * Read a project extension's activation policy without importing its module.
 *
 * Missing manifests retain legacy automatic discovery. Once a manifest is
 * present, malformed data rejects discovery with a contextual error rather
 * than guessing an activation mode, so an explicit-only extension cannot fail
 * open.
 */
async function resolveProjectExtensionActivation(
  extensionDirectory: string,
): Promise<ExtensionActivationMode> {
  let resolvedActivation: ExtensionActivationMode = "auto";
  const manifests: ReadonlyArray<readonly [string, ExtensionManifestSyntax]> = [
    ["deno.json", "jsonc"],
    ["deno.jsonc", "jsonc"],
    ["package.json", "json"],
  ];

  for (const [manifestName, syntax] of manifests) {
    const manifestPath = join(extensionDirectory, manifestName);
    const readResult = await readExtensionManifest(manifestPath, { syntax });
    if (readResult.kind === "missing") continue;
    const activation = projectManifestActivation(readResult.manifest, manifestPath);

    // When both Deno and npm manifests exist, the stricter declaration owns
    // activation. A package manifest therefore cannot be bypassed by adding a
    // second manifest that permits automatic discovery.
    if (activation === "explicit") resolvedActivation = "explicit";
  }
  return resolvedActivation;
}

/**
 * Scan `node_modules` (including `@scoped` packages) for packages
 * that declare veryfront extension metadata in their `package.json`.
 */
export async function discoverBoundPackageExtensions(
  baseDir: string,
): Promise<BoundDiscoveredPackageExtension[]> {
  const nmDir = join(baseDir, "node_modules");
  const results: BoundDiscoveredPackageExtension[] = [];
  const entries = await readDir(nmDir);

  for (const entry of entries) {
    // Accept symlinks so pnpm-style node_modules layouts are discovered.
    if (!entry.isDirectory && !entry.isSymlink) continue;

    if (entry.name.startsWith("@")) {
      // Scoped packages -- iterate one level deeper.
      const scopeDir = join(nmDir, entry.name);
      const scopeEntries = await readDir(scopeDir);
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory && !scopeEntry.isSymlink) continue;
        const pkgName = `${entry.name}/${scopeEntry.name}`;
        const hit = await tryReadPackageMeta(
          join(scopeDir, scopeEntry.name),
          pkgName,
        );
        if (hit) results.push(hit);
      }
    } else {
      const hit = await tryReadPackageMeta(
        join(nmDir, entry.name),
        entry.name,
      );
      if (hit) results.push(hit);
    }
  }

  return results;
}

/** Discover auto-activated package extensions without exposing identity internals. */
export async function discoverPackageExtensions(
  baseDir: string,
): Promise<DiscoveredPackageExtension[]> {
  return (await discoverBoundPackageExtensions(baseDir)).map((hit) => ({
    packageName: hit.packageName,
    importTarget: hit.importTarget,
    metadata: hit.metadata,
  }));
}

async function tryReadPackageMeta(
  pkgDir: string,
  packageName: string,
): Promise<BoundDiscoveredPackageExtension | undefined> {
  let owner;
  try {
    owner = await captureExtensionOwner(pkgDir);
  } catch (error) {
    // Broken node_modules entries are not extension candidates. Capturing the
    // physical owner before reading package.json prevents a pnpm symlink from
    // authorizing code in a different package if it is retargeted mid-scan.
    if (
      error instanceof ExtensionEntrypointIdentityError &&
      error.reason === "identity-unavailable"
    ) {
      throw new TypeError(
        `Extension package ${
          quotedPath(packageName)
        } cannot be discovered securely because stable filesystem identity is unavailable`,
        { cause: error },
      );
    }
    if (error instanceof ExtensionEntrypointIdentityError) return undefined;
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw new TypeError(
      `Extension package ${
        quotedPath(packageName)
      } owning directory could not be verified securely`,
      { cause: error },
    );
  }

  const manifestPath = join(owner.canonicalPath, "package.json");
  let readResult;
  try {
    readResult = await readExtensionManifest(manifestPath, { syntax: "json" });
  } catch (error) {
    // A package whose manifest cannot be read safely is not eligible for
    // automatic discovery. Other packages must remain discoverable.
    if (error instanceof VeryfrontError) return undefined;
    throw error;
  }
  if (readResult.kind === "missing") return undefined;

  const pkg = readResult.manifest;
  if (!pkg || typeof pkg !== "object" || isArray(pkg)) {
    return undefined;
  }
  const metadata = parsePackageMetadata(pkg as Record<string, unknown>);
  if (!metadata) return undefined;
  if (resolvePackageActivation(metadata) === "explicit") {
    // Explicit packages are inert unless materialized in config. Do not let a
    // missing or intentionally unsupported export abort unrelated startup.
    return undefined;
  }

  try {
    const selectedEntrypoint = selectPackageImportEntrypoint(packageName, pkg);
    const binding = await bindExtensionEntrypoint(
      owner,
      selectedEntrypoint,
    );
    return { packageName, importTarget: binding.path, metadata, binding };
  } catch (error) {
    throw new TypeError(
      `Extension package ${quotedPath(packageName)} has an unsafe import target`,
      { cause: error },
    );
  }
}

/**
 * Discover project extensions living under `extensions/` in the project root.
 *
 * Looks for `extensions/<name>/src/index.ts` and `extensions/<name>/index.ts`.
 * Extensions whose manifest declares `veryfront.activation: "explicit"` are
 * deliberately omitted: only a materialized `config.extensions` entry may
 * activate them.
 */
export async function discoverBoundProjectExtensions(
  baseDir: string,
): Promise<BoundDiscoveredProjectExtension[]> {
  const extDir = join(baseDir, "extensions");
  const entries = await readDir(extDir);
  if (entries.length === 0) return [];

  const extensionsRoot = await captureExtensionOwner(extDir);
  const results: BoundDiscoveredProjectExtension[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const extensionDirectory = join(extDir, entry.name);
    const owner = await captureExtensionOwner(extensionDirectory, {
      parent: extensionsRoot,
    });
    const srcIndex = join(owner.canonicalPath, "src", "index.ts");
    const rootIndex = join(owner.canonicalPath, "index.ts");
    const selectedEntrypoint = await pathEntryExists(srcIndex)
      ? "./src/index.ts"
      : await pathEntryExists(rootIndex)
      ? "./index.ts"
      : undefined;
    if (!selectedEntrypoint) continue;

    const activation = await resolveProjectExtensionActivation(owner.canonicalPath);
    if (activation === "explicit") continue;

    try {
      const binding = await bindExtensionEntrypoint(owner, selectedEntrypoint);
      results.push({ extensionName: entry.name, binding });
    } catch (error) {
      throw new TypeError(
        `Project extension entrypoint ${
          quotedPath(join(extensionDirectory, selectedEntrypoint))
        } is not a safe regular file within its extension directory`,
        { cause: error },
      );
    }
  }

  return results;
}

/** Discover project extension paths without exposing identity internals. */
export async function discoverProjectExtensions(
  baseDir: string,
): Promise<string[]> {
  return (await discoverBoundProjectExtensions(baseDir)).map((hit) => hit.binding.path);
}

/**
 * Find `*.extension.ts` files in the project root.
 *
 * These are ordinary trusted project source, not manifest-authorized package
 * code. Symlinks are ignored and the paths intentionally carry no discovery
 * identity binding; the factory loader still rejects file-URL remapping.
 */
export async function discoverLocalExtensions(
  baseDir: string,
): Promise<string[]> {
  const entries = await readDir(baseDir);
  return entries
    .filter((e) => e.isFile && e.name.endsWith(".extension.ts"))
    .map((e) => join(baseDir, e.name));
}
