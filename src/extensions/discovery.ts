/**
 * Multi-source extension discovery.
 *
 * Discovers extensions from four sources with priority:
 *   config > package > project > local-file
 *
 * @module extensions/discovery
 */

import { join } from "#veryfront/compat/path";
import type { Capability, PackageContractMetadata, ResolvedExtension } from "./types.ts";
import { EXTENSION_CONFLICT_ERROR } from "./errors.ts";
import { SOURCE_PRIORITY } from "./validation.ts";

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

export type ExtensionActivationMode = "auto" | "explicit";

const MISSING_METADATA_PROPERTY = Symbol("missing-extension-metadata-property");
const INVALID_METADATA_PROPERTY = Symbol("invalid-extension-metadata-property");
const MAX_EXTENSION_METADATA_ENTRIES = 1_024;
const MAX_PROJECT_EXTENSION_MANIFEST_BYTES = 256 * 1_024;
const manifestTextDecoder = new TextDecoder("utf-8", { fatal: true });

function readOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown | typeof MISSING_METADATA_PROPERTY | typeof INVALID_METADATA_PROPERTY {
  if (!value || typeof value !== "object") return INVALID_METADATA_PROPERTY;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return MISSING_METADATA_PROPERTY;
    return !descriptor.enumerable || descriptor.get || descriptor.set
      ? INVALID_METADATA_PROPERTY
      : descriptor.value;
  } catch {
    return INVALID_METADATA_PROPERTY;
  }
}

function readArrayDataValues(value: unknown): unknown[] | undefined {
  let isArray: boolean;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, "length") : undefined;
  } catch {
    return undefined;
  }
  const length = lengthDescriptor?.value;
  if (
    !isArray || lengthDescriptor?.get || lengthDescriptor?.set ||
    !Number.isSafeInteger(length) || length < 0 ||
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
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    return false;
  }
  if (value === null || typeof value !== "object" || isArray) return false;
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
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || isArray) return undefined;
  const contracts: PackageContractMetadata = {};
  const provides = parseStringList(readOwnDataProperty(value, "provides"));
  const requires = parseStringList(readOwnDataProperty(value, "requires"));
  if (provides) contracts.provides = provides;
  if (requires) contracts.requires = requires;
  return provides || requires ? contracts : undefined;
}

function parseActivationMode(
  metadata: Record<string, unknown>,
): ExtensionActivationMode | undefined {
  const activation = readOwnDataProperty(metadata, "activation");
  if (activation === MISSING_METADATA_PROPERTY) return "auto";
  return activation === "auto" || activation === "explicit" ? activation : undefined;
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
  let isArray: boolean;
  try {
    isArray = Array.isArray(vf);
  } catch {
    return undefined;
  }
  if (vf === null || typeof vf !== "object" || isArray) return undefined;

  const meta = vf as Record<string, unknown>;
  if (readOwnDataProperty(meta, "extension") !== true) {
    return undefined;
  }
  const activation = parseActivationMode(meta);
  if (!activation) return undefined;

  const capabilities = (readArrayDataValues(readOwnDataProperty(meta, "capabilities")) ?? [])
    .filter(isCapability);
  const contracts = parseContractMetadata(readOwnDataProperty(meta, "contracts"));

  return contracts
    ? { isExtension: true, activation, capabilities, contracts }
    : { isExtension: true, activation, capabilities };
}

/**
 * Merge extensions from all four sources in priority order.
 *
 * Priority (highest first): config > package > project > local-file.
 * Duplicates from different priorities keep the highest-priority entry.
 * Distinct duplicates at the same priority are rejected as ambiguous.
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

  // Process every source in deterministic order. Distinct extensions at equal
  // priority are ambiguous and must not be silently hidden before the
  // lifecycle loader can validate them.
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
    const current = seen.get(name);
    if (!current) {
      seen.set(name, resolved);
      continue;
    }

    const candidatePriority = SOURCE_PRIORITY[resolved.source];
    const currentPriority = SOURCE_PRIORITY[current.source];
    if (candidatePriority < currentPriority) {
      seen.set(name, resolved);
    } else if (
      candidatePriority === currentPriority &&
      current.extension !== resolved.extension
    ) {
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Duplicate extension name "${name}" from source "${resolved.source}"`,
      });
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
    return entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
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
  for (const manifestName of ["deno.json", "package.json"] as const) {
    const manifestPath = join(extensionDirectory, manifestName);
    let metadata: Deno.FileInfo;
    try {
      metadata = await Deno.lstat(manifestPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw new TypeError(`Project extension manifest "${manifestPath}" could not be inspected`, {
        cause: error,
      });
    }
    if (metadata.isSymlink || !metadata.isFile) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" must be a regular file`,
      );
    }
    if (
      !Number.isSafeInteger(metadata.size) || metadata.size < 0 ||
      metadata.size > MAX_PROJECT_EXTENSION_MANIFEST_BYTES
    ) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" exceeds the size limit`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(manifestPath);
    } catch (error) {
      throw new TypeError(`Project extension manifest "${manifestPath}" could not be read`, {
        cause: error,
      });
    }
    if (bytes.byteLength > MAX_PROJECT_EXTENSION_MANIFEST_BYTES) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" exceeds the size limit`,
      );
    }
    let source: string;
    try {
      source = manifestTextDecoder.decode(bytes);
    } catch (error) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" is not valid UTF-8`,
        { cause: error },
      );
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(source);
    } catch (error) {
      throw new TypeError(`Project extension manifest "${manifestPath}" is not valid JSON`, {
        cause: error,
      });
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new TypeError(`Project extension manifest "${manifestPath}" must be an object`);
    }
    const veryfront = readOwnDataProperty(manifest, "veryfront");
    if (veryfront === MISSING_METADATA_PROPERTY) continue;
    if (
      veryfront === INVALID_METADATA_PROPERTY || !veryfront ||
      typeof veryfront !== "object" || Array.isArray(veryfront)
    ) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" has invalid veryfront metadata; expected an object`,
      );
    }
    const activation = parseActivationMode(veryfront as Record<string, unknown>);
    if (!activation) {
      throw new TypeError(
        `Project extension manifest "${manifestPath}" has an invalid veryfront.activation mode`,
      );
    }
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
export async function discoverPackageExtensions(
  baseDir: string,
): Promise<Array<{ packageName: string; metadata: PackageMetadata }>> {
  const nmDir = join(baseDir, "node_modules");
  const results: Array<{ packageName: string; metadata: PackageMetadata }> = [];
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
        const meta = await tryReadPackageMeta(
          join(scopeDir, scopeEntry.name),
        );
        if (meta) results.push({ packageName: pkgName, metadata: meta });
      }
    } else {
      const meta = await tryReadPackageMeta(join(nmDir, entry.name));
      if (meta) results.push({ packageName: entry.name, metadata: meta });
    }
  }

  return results;
}

async function tryReadPackageMeta(
  pkgDir: string,
): Promise<PackageMetadata | undefined> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(pkgDir, "package.json"));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
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
 * Extensions whose manifest declares `veryfront.activation: "explicit"` are
 * deliberately omitted: only a materialized `config.extensions` entry may
 * activate them.
 */
export async function discoverProjectExtensions(
  baseDir: string,
): Promise<string[]> {
  const extDir = join(baseDir, "extensions");
  const entries = await readDir(extDir);
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const extensionDirectory = join(extDir, entry.name);
    const srcIndex = join(extensionDirectory, "src", "index.ts");
    const rootIndex = join(extensionDirectory, "index.ts");
    const entryPoint = await fileExists(srcIndex)
      ? srcIndex
      : await fileExists(rootIndex)
      ? rootIndex
      : undefined;
    if (!entryPoint) continue;

    const activation = await resolveProjectExtensionActivation(extensionDirectory);
    if (activation === "auto") results.push(entryPoint);
  }

  return results;
}

/**
 * Find `*.extension.ts` files in the project root.
 */
export async function discoverLocalExtensions(
  baseDir: string,
): Promise<string[]> {
  const entries = await readDir(baseDir);
  return entries
    .filter((e) => !e.isDirectory && e.name.endsWith(".extension.ts"))
    .map((e) => join(baseDir, e.name));
}
