/**
 * Extension orchestration pipeline.
 *
 * Discovers, loads, merges, sorts, and runs setup for every extension
 * contributed by the four sources (config, package, project, local-file).
 * Invoked once by `bootstrap()` after config resolution.
 *
 * @module extensions/orchestrate
 */

import { basename, dirname } from "@std/path";
import * as defaultDiscovery from "./discovery.ts";
import { loadExtensionFactory as defaultLoadFactory } from "./factory-loader.ts";
import { ExtensionLoader } from "./loader.ts";
import type {
  Extension,
  ExtensionConfigEntry,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";

/**
 * Options for `orchestrateExtensions`.
 *
 * The `discovery` and `loadFactory` fields are test seams — they are not
 * part of the stable public API and default to the real implementations.
 */
export interface OrchestrateOptions {
  projectDir: string;
  config: { extensions?: ExtensionConfigEntry[] };
  logger: ExtensionLogger;
  /** Contracts to seed into the registry after teardown, before setup(). */
  primeContracts?: Record<string, unknown>;
  /** Built-in extensions shipped with the framework. Lowest priority — any
   *  project, package, or config extension with the same name overrides them.
   *  Users can disable them via `{ name: "ext-llm-anthropic", enabled: false }`. */
  builtinExtensions?: ResolvedExtension[];
  /** Per-extension setup() timeout in milliseconds. Defaults to 30 000 ms.
   *  Pass `0` to disable. */
  setupTimeoutMs?: number;
  /**
   * @internal Release process-global resources owned by the previous
   * generation after its teardown and before candidate setup begins.
   */
  beforeActivate?: () => void | Promise<void>;
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

// The contract registry is process-global, so production orchestration must
// have one serialized generation owner. Direct ExtensionLoader construction is
// still available for tests and low-level use, but overlapping direct loaders
// are intentionally outside the supported lifecycle contract.
let orchestrationTail: Promise<void> = Promise.resolve();
let activeLoader: ExtensionLoader | undefined;
let failedCandidate: ExtensionLoader | undefined;

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
export function orchestrateExtensions(
  options: OrchestrateOptions,
): Promise<ExtensionLoader> {
  const result = orchestrationTail.then(() => orchestrateExtensionGeneration(options));
  orchestrationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function orchestrateExtensionGeneration(
  options: OrchestrateOptions,
): Promise<ExtensionLoader> {
  const { projectDir, config, logger } = options;
  const disc = options.discovery ?? defaultDiscovery;
  const loadFactory = options.loadFactory ?? defaultLoadFactory;

  const configEntries = Array.isArray(config.extensions) ? config.extensions : [];
  const disables: Array<{ name: string; enabled: false }> = [];
  const configResolved: ResolvedExtension[] = [];

  for (const entry of configEntries) {
    if (isDisableDirective(entry)) {
      disables.push(entry);
    } else {
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

  const [packageHits, projectPaths, localPaths] = await Promise.all([
    disc.discoverPackageExtensions(projectDir),
    disc.discoverProjectExtensions(projectDir),
    disc.discoverLocalExtensions(projectDir),
  ]);

  // Package hits carry the package name directly — filter before loading.
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
    options.builtinExtensions,
  );

  const loader = new ExtensionLoader(logger);
  if (options.primeContracts) {
    loader.primeContracts(options.primeContracts);
  }

  let activationStarted = false;
  try {
    await loader.setupAll(merged, config as Record<string, unknown>, {
      setupTimeoutMs: options.setupTimeoutMs,
      beforeActivate: async () => {
        // Candidate discovery, factory loading, flattening, validation,
        // conflict checks, and topology all completed before this hook. A bad
        // candidate therefore cannot tear down the active generation.
        const failed = failedCandidate;
        if (failed) {
          await failed.awaitLateSetupCleanup();
          if (failedCandidate === failed) failedCandidate = undefined;
        }

        const previous = activeLoader;
        if (previous) {
          await previous.teardownAll();
          if (activeLoader === previous) activeLoader = undefined;
        }
        await options.beforeActivate?.();
        activationStarted = true;
      },
    });
  } catch (error) {
    if (activationStarted) {
      activeLoader = undefined;
      // setupAll rejects promptly on timeout but retains its own losing setup
      // and cleanup barrier. Keep the candidate reachable so the next
      // generation cannot activate until that barrier succeeds.
      failedCandidate = loader;
    }
    throw error;
  }

  activeLoader = loader;
  return loader;
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
