/**
 * Extension orchestration pipeline.
 *
 * Discovers, loads, merges, sorts, and runs setup for every extension
 * contributed by the four sources (config, package, project, local-file).
 * Invoked once by `bootstrap()` after config resolution.
 *
 * @module extensions/orchestrate
 */

import { basename, dirname, isAbsolute } from "@std/path";
import * as defaultDiscovery from "./discovery.ts";
import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import { loadExtensionFactory as defaultLoadFactory } from "./factory-loader.ts";
import {
  hasAsciiWhitespaceOrControlCharacters,
  hasControlCharacters,
  identifierIssue,
  MAX_EXTENSION_NAME_LENGTH,
} from "./identifiers.ts";
import { ExtensionLoader } from "./loader.ts";
import { validateExtension } from "./validation.ts";
import type {
  Extension,
  ExtensionConfigEntry,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";

const MAX_ORCHESTRATED_EXTENSIONS = 4_096;
const MAX_DISCOVERY_VALUE_LENGTH = 4_096;

function isNonArrayObject(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Options for `orchestrateExtensions`.
 *
 * The `discovery` and `loadFactory` fields are test seams. They are not
 * part of the stable public API and default to the real implementations.
 */
export interface OrchestrateOptions {
  /** Absolute project directory used for extension discovery. */
  projectDir: string;
  /** Resolved project configuration. */
  config: { extensions?: ExtensionConfigEntry[] };
  /** Logger used for extension discovery and lifecycle events. */
  logger: ExtensionLogger;
  /** Contracts to seed into the registry after teardown, before setup(). */
  primeContracts?: Record<string, unknown>;
  /** Built-in extensions shipped with the framework. Lowest priority. Any
   *  project, package, or config extension with the same name overrides them.
   *  Users can disable them via `{ name: "ext-llm-anthropic", enabled: false }`. */
  builtinExtensions?: ResolvedExtension[];
  /** Per-extension setup() timeout in milliseconds. Defaults to 30 000 ms.
   *  Pass `0` to disable. */
  setupTimeoutMs?: number;
  /** @internal Override discovery functions in tests. */
  discovery?: {
    discoverPackageExtensions: typeof defaultDiscovery.discoverPackageExtensions;
    discoverProjectExtensions: typeof defaultDiscovery.discoverProjectExtensions;
    discoverLocalExtensions: typeof defaultDiscovery.discoverLocalExtensions;
    mergeExtensions: typeof defaultDiscovery.mergeExtensions;
  };
  /** @internal Override factory loading in tests. */
  loadFactory?: typeof defaultLoadFactory;
}

function isDisableDirective(
  entry: ExtensionConfigEntry,
): entry is { name: string; enabled: false } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "enabled" in entry &&
    (entry as { enabled: unknown }).enabled === false
  );
}

/**
 * Extract the extension name from a project-extension path.
 *
 * Project extensions live under `<baseDir>/extensions/<name>/...`. Discovery
 * emits either `<baseDir>/extensions/<name>/src/index.ts` or
 * `<baseDir>/extensions/<name>/index.ts`. This walks parent directories until
 * it finds the ancestor whose parent is `extensions/`.
 */
function projectExtensionNameFromPath(path: string): string | undefined {
  let current = dirname(path);
  // Safety limit in case of a malformed path that never reaches a root.
  for (let i = 0; i < 8; i++) {
    const parent = dirname(current);
    if (basename(parent) === "extensions") {
      return basename(current);
    }
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Run the full extension pipeline against a resolved project config.
 *
 * Pipeline:
 *   1. Split `config.extensions` into resolved entries and disable directives.
 *   2. Discover extensions from package, project, and local sources.
 *   3. Skip loading factories for package- and project-source extensions whose
 *      names appear in the disable set (local-file names are not reliable
 *      pre-load and are filtered after `mergeExtensions`).
 *   4. Dynamic-import factories for every remaining discovered path.
 *   5. Merge sources honoring priority `config > package > project > local-file`.
 *   6. Construct an `ExtensionLoader` and run `setupAll`.
 *
 * On factory error during `setup()`, `ExtensionLoader.setupAll` performs
 * partial rollback internally. The error is re-thrown unchanged so callers
 * can surface the extension name to the user.
 */
export async function orchestrateExtensions(
  options: OrchestrateOptions,
): Promise<ExtensionLoader> {
  const snapshot = snapshotOptions(options);
  const {
    builtinExtensions,
    config,
    configEntries,
    discovery: disc,
    loadFactory,
    logger,
    primeContracts,
    projectDir,
    setupTimeoutMs,
  } = snapshot;
  const disables: Array<{ name: string; enabled: false }> = [];
  const configResolved: ResolvedExtension[] = [];

  for (let index = 0; index < configEntries.length; index++) {
    const entry = configEntries[index]!;
    let disabled: boolean;
    try {
      disabled = isDisableDirective(entry);
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Config extension at index ${index} is invalid`,
      });
    }
    if (disabled) {
      const directive = entry as { name: string; enabled: false };
      const issue = identifierIssue(directive.name, MAX_EXTENSION_NAME_LENGTH);
      if (issue) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Disable directive name ${issue}`,
        });
      }
      disables.push(directive);
    } else {
      const issues = validateExtension(entry);
      if (issues.length > 0) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Config extension is invalid:\n  ${issues.join("\n  ")}`,
        });
      }
      configResolved.push({
        extension: entry as Extension,
        source: "config",
        origin: "veryfront.config",
      });
    }
  }

  // Build the disabled-names set early so we can skip dynamic imports for
  // extensions the user has explicitly turned off. A factory whose module
  // fails to import or invoke would otherwise take down bootstrap even
  // though the user asked for it to be disabled.
  const disabledNames = new Set(disables.map((d) => d.name));

  const loader = new ExtensionLoader(logger);
  if (primeContracts !== undefined) {
    loader.primeContracts(primeContracts);
  }

  const [rawPackageHits, rawProjectPaths, rawLocalPaths] = await Promise.all([
    disc.discoverPackageExtensions(projectDir),
    disc.discoverProjectExtensions(projectDir),
    disc.discoverLocalExtensions(projectDir),
  ]);
  const packageHits = readPackageDiscoveryResults(rawPackageHits);
  const projectPaths = readPathDiscoveryResults(rawProjectPaths);
  const localPaths = readPathDiscoveryResults(rawLocalPaths);

  // Package hits carry the package name directly. Filter before loading.
  const enabledPackageNames = packageHits
    .map((hit) => hit.packageName)
    .filter((name) => !disabledNames.has(name));

  // Project paths have the shape `<projectDir>/extensions/<name>/src/index.ts`
  // (or `<projectDir>/extensions/<name>/index.ts`). `mergeExtensions` is the
  // safety net for any path whose name cannot be derived.
  const enabledProjectPaths = projectPaths.filter((path) => {
    const name = projectExtensionNameFromPath(path);
    return name === undefined || !disabledNames.has(name);
  });

  // Local-file paths cannot be reliably filtered pre-load: the filename
  // (`foo.extension.ts`) is not guaranteed to match the extension name
  // declared by the factory. `mergeExtensions` applies the post-hoc filter.
  const packageResolved = await loadAllFactories(
    enabledPackageNames,
    "package",
    loadFactory,
  );
  const projectResolved = await loadAllFactories(
    enabledProjectPaths,
    "project",
    loadFactory,
  );
  const localResolved = await loadAllFactories(
    localPaths,
    "local-file",
    loadFactory,
  );

  const merged = disc.mergeExtensions(
    configResolved,
    packageResolved,
    projectResolved,
    localResolved,
    disables,
    builtinExtensions,
  );

  await loader.setupAll(merged, config as Record<string, unknown>, {
    setupTimeoutMs,
  });
  return loader;
}

function snapshotOptions(options: OrchestrateOptions) {
  if (!isNonArrayObject(options)) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Extension options must be an object" });
  }

  let builtinExtensions: unknown;
  let config: unknown;
  let discovery: unknown;
  let loadFactory: unknown;
  let logger: unknown;
  let primeContracts: unknown;
  let projectDir: unknown;
  let setupTimeoutMs: unknown;
  try {
    builtinExtensions = Reflect.get(options, "builtinExtensions");
    config = Reflect.get(options, "config");
    discovery = Reflect.get(options, "discovery");
    loadFactory = Reflect.get(options, "loadFactory");
    logger = Reflect.get(options, "logger");
    primeContracts = Reflect.get(options, "primeContracts");
    projectDir = Reflect.get(options, "projectDir");
    setupTimeoutMs = Reflect.get(options, "setupTimeoutMs");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension option fields could not be read safely",
    });
  }

  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > MAX_DISCOVERY_VALUE_LENGTH ||
    hasControlCharacters(projectDir) || !isAbsolute(projectDir)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "projectDir is invalid" });
  }
  if (!isNonArrayObject(config)) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Extension config must be an object" });
  }

  let rawConfigEntries: unknown;
  try {
    rawConfigEntries = Reflect.get(config, "extensions");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "config.extensions could not be read safely",
    });
  }
  if (rawConfigEntries !== undefined) {
    try {
      if (!Array.isArray(rawConfigEntries)) throw new TypeError();
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "config.extensions must be an array when provided",
      });
    }
  }
  const configEntries = copyBoundedArray<ExtensionConfigEntry>(
    rawConfigEntries ?? [],
    "config.extensions",
  );

  const safeLogger = readLogger(logger);
  const safeDiscovery = readDiscovery(discovery);
  if (loadFactory !== undefined && typeof loadFactory !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "loadFactory must be a function" });
  }
  if (primeContracts !== undefined) {
    if (!isNonArrayObject(primeContracts)) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "primeContracts must be an object" });
    }
  }
  if (setupTimeoutMs !== undefined && typeof setupTimeoutMs !== "number") {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "setupTimeoutMs must be a number" });
  }

  return {
    builtinExtensions: readBuiltinExtensions(builtinExtensions),
    config,
    configEntries,
    discovery: safeDiscovery,
    loadFactory: (loadFactory ?? defaultLoadFactory) as typeof defaultLoadFactory,
    logger: safeLogger,
    primeContracts: primeContracts as Record<string, unknown> | undefined,
    projectDir,
    setupTimeoutMs,
  };
}

function copyBoundedArray<T>(value: unknown, field: string): T[] {
  try {
    if (!Array.isArray(value)) throw new TypeError();
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: `${field} must be an array` });
  }
  let length: unknown;
  try {
    length = Reflect.get(value as object, "length");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: `${field} could not be read safely` });
  }
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_ORCHESTRATED_EXTENSIONS
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `${field} must contain at most ${MAX_ORCHESTRATED_EXTENSIONS} entries`,
    });
  }
  const result: T[] = [];
  try {
    for (let index = 0; index < length; index++) result.push(Reflect.get(value, index) as T);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: `${field} could not be read safely` });
  }
  return result;
}

function readLogger(value: unknown): ExtensionLogger {
  if (!isNonArrayObject(value)) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "logger must be an object" });
  }
  try {
    const debug = Reflect.get(value, "debug");
    const info = Reflect.get(value, "info");
    const warn = Reflect.get(value, "warn");
    const error = Reflect.get(value, "error");
    if (
      typeof debug !== "function" || typeof info !== "function" ||
      typeof warn !== "function" || typeof error !== "function"
    ) {
      throw new TypeError();
    }
    return {
      debug: debug.bind(value),
      info: info.bind(value),
      warn: warn.bind(value),
      error: error.bind(value),
    };
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "logger must provide debug, info, warn, and error functions",
    });
  }
}

function readDiscovery(value: unknown) {
  if (value === undefined) return defaultDiscovery;
  if (!isNonArrayObject(value)) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "discovery must be an object" });
  }
  try {
    const discoverPackageExtensions = Reflect.get(value, "discoverPackageExtensions");
    const discoverProjectExtensions = Reflect.get(value, "discoverProjectExtensions");
    const discoverLocalExtensions = Reflect.get(value, "discoverLocalExtensions");
    const mergeExtensions = Reflect.get(value, "mergeExtensions");
    if (
      typeof discoverPackageExtensions !== "function" ||
      typeof discoverProjectExtensions !== "function" ||
      typeof discoverLocalExtensions !== "function" ||
      typeof mergeExtensions !== "function"
    ) {
      throw new TypeError();
    }
    return {
      discoverPackageExtensions: discoverPackageExtensions.bind(value),
      discoverProjectExtensions: discoverProjectExtensions.bind(value),
      discoverLocalExtensions: discoverLocalExtensions.bind(value),
      mergeExtensions: mergeExtensions.bind(value),
    } as typeof defaultDiscovery;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "discovery must provide the extension discovery functions",
    });
  }
}

function readBuiltinExtensions(value: unknown): ResolvedExtension[] | undefined {
  if (value === undefined) return undefined;
  const entries = copyBoundedArray<ResolvedExtension>(value, "builtinExtensions");
  for (const entry of entries) {
    let extension: unknown;
    let origin: unknown;
    let source: unknown;
    try {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError();
      }
      extension = Reflect.get(entry, "extension");
      origin = Reflect.get(entry, "origin");
      source = Reflect.get(entry, "source");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Builtin extension is invalid" });
    }
    const issues = validateExtension(extension);
    if (
      issues.length > 0 || source !== "builtin" || typeof origin !== "string" ||
      origin.length === 0 || origin.length > MAX_DISCOVERY_VALUE_LENGTH ||
      hasControlCharacters(origin)
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Builtin extension is invalid" });
    }
  }
  return entries;
}

function readPackageDiscoveryResults(value: unknown) {
  const entries = copyBoundedArray<{ packageName: string }>(value, "Package discovery result");
  return entries.map((entry) => {
    let packageName: unknown;
    try {
      packageName = isNonArrayObject(entry) ? Reflect.get(entry, "packageName") : undefined;
    } catch {
      packageName = undefined;
    }
    if (
      typeof packageName !== "string" || packageName.length === 0 ||
      packageName.length > MAX_EXTENSION_NAME_LENGTH ||
      hasAsciiWhitespaceOrControlCharacters(packageName) || packageName.includes("\\")
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Package discovery result is invalid" });
    }
    return entry as { packageName: string; metadata: defaultDiscovery.PackageMetadata };
  });
}

function readPathDiscoveryResults(value: unknown): string[] {
  const entries = copyBoundedArray<unknown>(value, "Path discovery result");
  for (const path of entries) {
    if (
      typeof path !== "string" || path.length === 0 ||
      path.length > MAX_DISCOVERY_VALUE_LENGTH || hasControlCharacters(path)
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Path discovery result is invalid" });
    }
  }
  return entries as string[];
}

async function loadAllFactories(
  paths: string[],
  source: ExtensionSource,
  loadFactory: typeof defaultLoadFactory,
): Promise<ResolvedExtension[]> {
  const resolved: ResolvedExtension[] = [];
  for (const path of paths) {
    resolved.push(await loadFactory(path, source));
  }
  return resolved;
}
