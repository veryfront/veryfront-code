import type { ChunkAnalysis, ChunkManifest, ChunkSuggestion, PageImports } from "./contracts.ts";
import { hasControlCharacter, readOwnDataProperty } from "./data-properties.ts";
import {
  MAX_IMPORT_SPECIFIER_CHARS,
  MAX_IMPORTS_PER_PAGE,
  MAX_MANIFEST_CHUNKS,
  MAX_PAGE_FILES,
  MAX_SCANNED_PATH_CHARS,
  MAX_TOTAL_MANIFEST_DEPENDENCY_CHARS,
  MAX_TOTAL_MANIFEST_DEPENDENCY_ENTRIES,
  MAX_TOTAL_MANIFEST_KEY_CHARS,
  MAX_TOTAL_MANIFEST_PAGE_CHUNK_REFERENCES,
} from "./limits.ts";

function assertManifestKey(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SCANNED_PATH_CHARS ||
    hasControlCharacter(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
}

interface ManifestBudget {
  dependencyEntries: number;
  dependencyChars: number;
  keyChars: number;
  pageChunkReferences: number;
}

function consumeKeyBudget(
  budget: ManifestBudget,
  value: string,
): void {
  if (value.length > MAX_TOTAL_MANIFEST_KEY_CHARS - budget.keyChars) {
    throw new RangeError(
      `Chunk manifest key budget of ${MAX_TOTAL_MANIFEST_KEY_CHARS} characters was exceeded`,
    );
  }
  budget.keyChars += value.length;
}

function readDenseArrayLength(
  value: unknown,
  label: string,
  limit: number,
): number {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    // Revoked and otherwise hostile proxies are not valid manifest data.
  }
  if (!isArray) throw new TypeError(`${label} must be an array`);

  const length = readOwnDataProperty(value, "length");
  if (
    !length.found ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  ) {
    throw new TypeError(`${label} must have a safe own data-property length`);
  }
  if (length.value > limit) {
    throw new RangeError(`${label} may contain at most ${limit} entries`);
  }
  return length.value;
}

function readDenseArrayEntry(
  values: unknown,
  index: number,
  label: string,
): unknown {
  const entry = readOwnDataProperty(values, String(index));
  if (!entry.found) {
    throw new TypeError(`${label} must contain only dense data properties`);
  }
  return entry.value;
}

function copyStringArray(
  values: unknown,
  label: string,
  budget: ManifestBudget,
  entryLimit: number,
): string[] {
  const length = readDenseArrayLength(values, label, entryLimit);

  const copy: string[] = [];
  for (let index = 0; index < length; index++) {
    const entry = readOwnDataProperty(values, String(index));
    if (!entry.found || typeof entry.value !== "string") {
      throw new TypeError(
        `${label} must contain only dense string data properties`,
      );
    }
    if (
      entry.value.length === 0 ||
      entry.value.length > MAX_IMPORT_SPECIFIER_CHARS ||
      hasControlCharacter(entry.value)
    ) {
      throw new TypeError(`${label} contains an invalid dependency`);
    }
    if (budget.dependencyEntries >= MAX_TOTAL_MANIFEST_DEPENDENCY_ENTRIES) {
      throw new RangeError(
        `Chunk manifest dependency-entry limit of ${MAX_TOTAL_MANIFEST_DEPENDENCY_ENTRIES} was exceeded`,
      );
    }
    if (
      entry.value.length >
        MAX_TOTAL_MANIFEST_DEPENDENCY_CHARS - budget.dependencyChars
    ) {
      throw new RangeError(
        `Chunk manifest dependency budget of ${MAX_TOTAL_MANIFEST_DEPENDENCY_CHARS} characters was exceeded`,
      );
    }
    budget.dependencyEntries++;
    budget.dependencyChars += entry.value.length;
    copy.push(entry.value);
  }
  return copy;
}

function snapshotMapEntries(
  value: unknown,
  label: string,
  limit: number,
): Array<[unknown, unknown]> {
  let iterator: IterableIterator<[unknown, unknown]>;
  try {
    iterator = Map.prototype.entries.call(value) as IterableIterator<
      [unknown, unknown]
    >;
  } catch {
    throw new TypeError(`${label} must be a Map`);
  }

  const entries: Array<[unknown, unknown]> = [];
  for (const entry of iterator) {
    if (entries.length >= limit) {
      throw new RangeError(`${label} may contain at most ${limit} entries`);
    }
    entries.push(entry);
  }
  return entries;
}

function snapshotChunkSuggestion(
  value: unknown,
  index: number,
  budget: ManifestBudget,
): Pick<ChunkSuggestion, "name" | "deps" | "benefit"> {
  const label = `Chunk suggestion ${index}`;
  const name = readOwnDataProperty(value, "name");
  const dependencies = readOwnDataProperty(value, "deps");
  const benefit = readOwnDataProperty(value, "benefit");
  if (
    !name.found ||
    typeof name.value !== "string" ||
    !dependencies.found ||
    !benefit.found ||
    typeof benefit.value !== "number"
  ) {
    throw new TypeError(`${label} must expose own data properties`);
  }

  assertManifestKey(name.value, `${label} name`);
  consumeKeyBudget(budget, name.value);
  if (!Number.isSafeInteger(benefit.value) || benefit.value < 0) {
    throw new RangeError(
      `${label} benefit must be a finite non-negative safe integer`,
    );
  }
  return {
    name: name.value,
    deps: copyStringArray(
      dependencies.value,
      `${label} dependencies`,
      budget,
      MAX_TOTAL_MANIFEST_DEPENDENCY_ENTRIES,
    ),
    benefit: benefit.value,
  };
}

function snapshotPageImports(
  value: unknown,
  pagePath: string,
  budget: ManifestBudget,
): PageImports {
  const declaredPath = readOwnDataProperty(value, "path");
  const local = readOwnDataProperty(value, "local");
  const remote = readOwnDataProperty(value, "remote");
  const shared = readOwnDataProperty(value, "shared");
  if (
    !declaredPath.found ||
    declaredPath.value !== pagePath ||
    !local.found ||
    !remote.found ||
    !shared.found
  ) {
    throw new TypeError(
      `Page ${pagePath} must expose matching path and dependency data properties`,
    );
  }
  const localLength = readDenseArrayLength(
    local.value,
    `Page ${pagePath} local dependencies`,
    MAX_IMPORTS_PER_PAGE,
  );
  const remoteLength = readDenseArrayLength(
    remote.value,
    `Page ${pagePath} remote dependencies`,
    MAX_IMPORTS_PER_PAGE,
  );
  const sharedLength = readDenseArrayLength(
    shared.value,
    `Page ${pagePath} shared dependencies`,
    MAX_IMPORTS_PER_PAGE,
  );
  if (localLength + remoteLength + sharedLength > MAX_IMPORTS_PER_PAGE) {
    throw new RangeError(
      `Page ${pagePath} dependency arrays may contain at most ${MAX_IMPORTS_PER_PAGE} total entries`,
    );
  }
  return {
    path: pagePath,
    local: copyStringArray(
      local.value,
      `Page ${pagePath} local dependencies`,
      budget,
      localLength,
    ),
    remote: copyStringArray(
      remote.value,
      `Page ${pagePath} remote dependencies`,
      budget,
      remoteLength,
    ),
    shared: copyStringArray(
      shared.value,
      `Page ${pagePath} shared dependencies`,
      budget,
      sharedLength,
    ),
  };
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Validate and detach an analysis result into a serializable manifest. */
export function generateChunkManifest(
  analysis: ChunkAnalysis,
): ChunkManifest {
  const pagesProperty = readOwnDataProperty(analysis, "pages");
  const suggestionsProperty = readOwnDataProperty(analysis, "suggestedChunks");
  if (!pagesProperty.found || !suggestionsProperty.found) {
    throw new TypeError(
      "Chunk analysis must expose pages and suggestedChunks as own data properties",
    );
  }
  const pageEntries = snapshotMapEntries(
    pagesProperty.value,
    "Chunk manifest pages",
    MAX_PAGE_FILES,
  );
  const suggestionCount = readDenseArrayLength(
    suggestionsProperty.value,
    "Chunk manifest suggestions",
    MAX_MANIFEST_CHUNKS,
  );
  const budget: ManifestBudget = {
    dependencyEntries: 0,
    dependencyChars: 0,
    keyChars: 0,
    pageChunkReferences: 0,
  };

  const manifest: ChunkManifest = {
    version: "1.0",
    chunks: Object.create(null) as ChunkManifest["chunks"],
    pages: Object.create(null) as ChunkManifest["pages"],
  };

  const chunkNames: string[] = [];
  const chunksByDependency = new Map<string, number[]>();
  for (let index = 0; index < suggestionCount; index++) {
    const suggestion = snapshotChunkSuggestion(
      readDenseArrayEntry(
        suggestionsProperty.value,
        index,
        "Chunk manifest suggestions",
      ),
      index,
      budget,
    );
    if (Object.hasOwn(manifest.chunks, suggestion.name)) {
      throw new TypeError(`Duplicate chunk name: ${suggestion.name}`);
    }
    defineRecordValue(manifest.chunks, suggestion.name, {
      deps: suggestion.deps,
      size: suggestion.benefit,
    });
    const ordinal = chunkNames.length;
    chunkNames.push(suggestion.name);
    for (const dependency of new Set(suggestion.deps)) {
      const ordinals = chunksByDependency.get(dependency);
      if (ordinals) ordinals.push(ordinal);
      else chunksByDependency.set(dependency, [ordinal]);
    }
  }

  const sortedPageEntries = pageEntries.map(([pagePath, imports]) => {
    if (typeof pagePath !== "string") {
      throw new TypeError("Chunk manifest page paths must be strings");
    }
    assertManifestKey(pagePath, "Chunk manifest page path");
    consumeKeyBudget(budget, pagePath);
    return [pagePath, imports] as const;
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

  for (const [pagePath, rawImports] of sortedPageEntries) {
    const imports = snapshotPageImports(rawImports, pagePath, budget);
    const chunkOrdinals = new Set<number>();
    for (const dependency of [...imports.remote, ...imports.shared]) {
      for (const ordinal of chunksByDependency.get(dependency) ?? []) {
        chunkOrdinals.add(ordinal);
      }
    }
    const pageChunks = [...chunkOrdinals]
      .sort((left, right) => left - right)
      .map((ordinal) => chunkNames[ordinal]!);
    if (
      pageChunks.length >
        MAX_TOTAL_MANIFEST_PAGE_CHUNK_REFERENCES - budget.pageChunkReferences
    ) {
      throw new RangeError(
        `Chunk manifest page-chunk reference limit of ${MAX_TOTAL_MANIFEST_PAGE_CHUNK_REFERENCES} was exceeded`,
      );
    }
    budget.pageChunkReferences += pageChunks.length;

    defineRecordValue(manifest.pages, pagePath, {
      chunks: pageChunks,
      deps: {
        local: imports.local,
        remote: imports.remote,
        shared: imports.shared,
      },
    });
  }

  return manifest;
}
