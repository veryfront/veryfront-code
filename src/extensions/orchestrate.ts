/**
 * Extension orchestration pipeline.
 *
 * Discovers, loads, merges, sorts, and runs setup for every extension
 * contributed by the four sources (config, package, project, local-file).
 * Invoked once by `bootstrap()` after config resolution.
 *
 * @module extensions/orchestrate
 */

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
 * Run the full extension pipeline against a resolved project config.
 *
 * Pipeline:
 *   1. Discover extensions from package, project, and local sources.
 *   2. Dynamic-import factories for each discovered path.
 *   3. Split `config.extensions` into resolved entries and disable directives.
 *   4. Merge sources honoring priority `config > package > project > local-file`.
 *   5. Construct an `ExtensionLoader` and run `setupAll`.
 *
 * On factory error during `setup()`, `ExtensionLoader.setupAll` performs
 * partial rollback internally. The error is re-thrown unchanged so callers
 * can surface the extension name to the user.
 */
export async function orchestrateExtensions(
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

  const [packageHits, projectPaths, localPaths] = await Promise.all([
    disc.discoverPackageExtensions(projectDir),
    disc.discoverProjectExtensions(projectDir),
    disc.discoverLocalExtensions(projectDir),
  ]);

  const packageResolved = await loadAllFactories(
    packageHits.map((hit) => hit.packageName),
    "package",
    loadFactory,
  );
  const projectResolved = await loadAllFactories(
    projectPaths,
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
  );

  const loader = new ExtensionLoader(logger);
  await loader.setupAll(merged, config as Record<string, unknown>);
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
