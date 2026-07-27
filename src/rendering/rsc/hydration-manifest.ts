const MAX_MANIFEST_MODULES = 100_000;
const MAX_MANIFEST_COMPONENTS = 100_000;
const MAX_MANIFEST_GRAPH_ENTRIES = 100_000;
const MAX_EXPORTS_PER_MODULE = 1_024;
const MAX_TOTAL_EXPORTS = 200_000;
const MAX_ID_CHARACTERS = 4_096;
const MAX_PATH_CHARACTERS = 65_536;
const MAX_HASH_CHARACTERS = 256;
const MAX_TOTAL_STRING_CHARACTERS = 16 * 1024 * 1024;

export interface HydrationManifestModule {
  readonly id: string;
  readonly clientRef: string;
  readonly exports: readonly string[];
}

export interface HydrationManifestGraphEntry {
  readonly id: string;
  readonly path: string;
  readonly rel: string;
}

export interface HydrationManifest {
  readonly version: 1;
  readonly hash?: string;
  readonly components?: Readonly<Record<string, string>>;
  readonly modules: readonly HydrationManifestModule[];
  readonly graphIds?: {
    readonly client: readonly HydrationManifestGraphEntry[];
    readonly server: readonly HydrationManifestGraphEntry[];
  };
}

interface StringBudget {
  characters: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return false;
}

function readBoundedString(
  value: unknown,
  maxCharacters: number,
  budget: StringBudget,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxCharacters ||
    hasControlCharacters(value)
  ) {
    throw new TypeError("Hydration manifest contains an invalid string field");
  }

  budget.characters += value.length;
  if (budget.characters > MAX_TOTAL_STRING_CHARACTERS) {
    throw new RangeError("Hydration manifest string budget was exceeded");
  }
  return value;
}

function snapshotComponents(
  value: unknown,
  budget: StringBudget,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw new TypeError("Hydration manifest components must be an object");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_MANIFEST_COMPONENTS) {
    throw new RangeError("Hydration manifest component limit was exceeded");
  }

  const components = Object.create(null) as Record<string, string>;
  for (const [rawId, rawUrl] of entries) {
    const id = readBoundedString(rawId, MAX_ID_CHARACTERS, budget);
    const url = readBoundedString(rawUrl, MAX_PATH_CHARACTERS, budget);
    Object.defineProperty(components, id, {
      configurable: false,
      enumerable: true,
      value: url,
      writable: false,
    });
  }
  return Object.freeze(components);
}

function snapshotModules(
  value: unknown,
  budget: StringBudget,
): readonly HydrationManifestModule[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Hydration manifest modules must be an array");
  }
  if (value.length > MAX_MANIFEST_MODULES) {
    throw new RangeError("Hydration manifest module limit was exceeded");
  }

  const modules: HydrationManifestModule[] = [];
  const ids = new Set<string>();
  let totalExports = 0;

  for (const rawModule of value) {
    if (!isPlainRecord(rawModule)) {
      throw new TypeError("Hydration manifest modules must be objects");
    }

    const id = readBoundedString(rawModule.id, MAX_ID_CHARACTERS, budget);
    if (ids.has(id)) {
      throw new TypeError("Hydration manifest contains a duplicate module id");
    }
    ids.add(id);

    const clientRef = readBoundedString(
      rawModule.clientRef,
      MAX_PATH_CHARACTERS,
      budget,
    );
    if (!Array.isArray(rawModule.exports)) {
      throw new TypeError("Hydration manifest module exports must be an array");
    }
    if (rawModule.exports.length > MAX_EXPORTS_PER_MODULE) {
      throw new RangeError("Hydration manifest per-module export limit was exceeded");
    }

    totalExports += rawModule.exports.length;
    if (totalExports > MAX_TOTAL_EXPORTS) {
      throw new RangeError("Hydration manifest export limit was exceeded");
    }

    const exportNames = rawModule.exports.map((exportName) =>
      readBoundedString(exportName, MAX_ID_CHARACTERS, budget)
    );
    if (new Set(exportNames).size !== exportNames.length) {
      throw new TypeError("Hydration manifest contains duplicate module exports");
    }

    modules.push(Object.freeze({
      id,
      clientRef,
      exports: Object.freeze(exportNames),
    }));
  }

  return Object.freeze(modules);
}

function snapshotGraphEntries(
  value: unknown,
  budget: StringBudget,
): readonly HydrationManifestGraphEntry[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Hydration manifest graph entries must be an array");
  }
  if (value.length > MAX_MANIFEST_GRAPH_ENTRIES) {
    throw new RangeError("Hydration manifest graph-entry limit was exceeded");
  }

  const entries: HydrationManifestGraphEntry[] = [];
  const ids = new Set<string>();
  const relativePaths = new Set<string>();

  for (const rawEntry of value) {
    if (!isPlainRecord(rawEntry)) {
      throw new TypeError("Hydration manifest graph entries must be objects");
    }

    const id = readBoundedString(rawEntry.id, MAX_ID_CHARACTERS, budget);
    const path = readBoundedString(rawEntry.path, MAX_PATH_CHARACTERS, budget);
    const rel = readBoundedString(rawEntry.rel, MAX_PATH_CHARACTERS, budget);
    if (ids.has(id) || relativePaths.has(rel)) {
      throw new TypeError("Hydration manifest graph identities must be unique");
    }
    ids.add(id);
    relativePaths.add(rel);
    entries.push(Object.freeze({ id, path, rel }));
  }

  return Object.freeze(entries);
}

function snapshotGraph(
  value: unknown,
  budget: StringBudget,
): HydrationManifest["graphIds"] {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw new TypeError("Hydration manifest graphIds must be an object");
  }

  return Object.freeze({
    client: snapshotGraphEntries(value.client, budget),
    server: snapshotGraphEntries(value.server, budget),
  });
}

/**
 * Admit and detach the network manifest before it participates in imports.
 */
export function parseHydrationManifest(value: unknown): HydrationManifest | null {
  try {
    if (!isPlainRecord(value) || value.version !== 1) return null;
    const budget: StringBudget = { characters: 0 };
    const hash = value.hash === undefined
      ? undefined
      : readBoundedString(value.hash, MAX_HASH_CHARACTERS, budget);

    return Object.freeze({
      version: 1,
      ...(hash === undefined ? {} : { hash }),
      components: snapshotComponents(value.components, budget),
      modules: snapshotModules(value.modules, budget),
      graphIds: snapshotGraph(value.graphIds, budget),
    });
  } catch {
    return null;
  }
}
