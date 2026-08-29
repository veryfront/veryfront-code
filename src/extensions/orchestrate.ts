/**
 * Extension orchestration pipeline.
 *
 * Discovers, loads, merges, sorts, and runs setup for every extension
 * contributed by the four sources (config, package, project, local-file).
 * Invoked once by `bootstrap()` after config resolution.
 *
 * @module extensions/orchestrate
 */

import { basename, dirname } from "#veryfront/compat/path";
import { getDeferredExtensionState } from "./deferred-extension.ts";
import * as defaultDiscovery from "./discovery.ts";
import type { BoundExtensionEntrypoint } from "./entrypoint-identity.ts";
import { loadExtensionFactory as defaultLoadFactory } from "./factory-loader.ts";
import {
  FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES,
  FIRST_PARTY_EXTENSION_POLICIES,
} from "./first-party-defaults.ts";
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
 * The `discovery` and `loadFactory` fields are test seams -- they are not
 * part of the stable public API and default to the real implementations.
 */
export interface OrchestrateOptions {
  projectDir: string;
  config: { extensions?: ExtensionConfigEntry[] };
  logger: ExtensionLogger;
  /** Contracts to seed into the registry after teardown, before setup(). */
  primeContracts?: Record<string, unknown>;
  /** Built-in extensions shipped with the framework. Lowest priority -- any
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
  /**
   * @internal Override discovery functions in tests.
   *
   * This is a trusted injection seam, not an untrusted-data boundary. A custom
   * implementation controls import targets directly and must return ordinary
   * data objects, not live or revoked Proxies.
   */
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
const FIRST_PARTY_BUILTIN_PACKAGE_TO_EXTENSION = new Map(
  FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES.map((policy) => [
    `@veryfront/${policy.sourceDirectory}`,
    policy.name,
  ]),
);
const FIRST_PARTY_BUILTIN_EXTENSION_TO_PACKAGE = new Map(
  FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES.map((policy) => [
    policy.name,
    `@veryfront/${policy.sourceDirectory}`,
  ]),
);

const FIRST_PARTY_EXTENSION_NAMES = new Set(
  FIRST_PARTY_EXTENSION_POLICIES.map((policy) => policy.name),
);

/**
 * A first-party extension declaration, `{ name: "ext-..." }` and nothing
 * else -- the inert marker a hosted declarative config produces for an
 * imported extension factory call (veryfront-issue-inbox#688). The runtime
 * provides the capability itself, so the declaration activates nothing.
 */
/** @internal Exported for direct accessor-safety coverage. */
export function isFirstPartyDeclarationMarker(
  entry: ExtensionConfigEntry,
): entry is { name: string } {
  if (typeof entry !== "object" || entry === null) return false;
  try {
    // Reflect.ownKeys sees non-enumerable and symbol keys that Object.keys
    // misses: a malformed materialized extension carrying hidden fields must
    // fail validation, not vanish as an inert declaration.
    const keys = Reflect.ownKeys(entry);
    if (keys.length !== 1 || keys[0] !== "name") return false;
    // Descriptor inspection, like validateExtension: an accessor-backed `name`
    // must neither run user code here nor classify as an inert marker.
    const descriptor = Object.getOwnPropertyDescriptor(entry, "name");
    return descriptor !== undefined && "value" in descriptor &&
      typeof descriptor.value === "string" &&
      FIRST_PARTY_EXTENSION_NAMES.has(descriptor.value);
  } catch {
    // A revoked proxy or throwing trap is not a marker; ordinary extension
    // validation owns the typed error for it.
    return false;
  }
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
  while (true) {
    const parent = dirname(current);
    if (basename(parent) === "extensions") {
      return basename(current);
    }
    if (parent === current) return undefined;
    current = parent;
  }
}

interface FactoryLoadTarget {
  path: string;
  binding?: BoundExtensionEntrypoint;
}

interface PackageLoadCandidate {
  packageName: string;
  metadata: defaultDiscovery.PackageMetadata;
  target: FactoryLoadTarget;
}

interface ProjectLoadCandidate {
  extensionName?: string;
  target: FactoryLoadTarget;
}

function buildDisableFilters(
  disables: Array<{ name: string; enabled: false }>,
): { extensionNames: Set<string>; packageNames: Set<string> } {
  const extensionNames = new Set<string>();
  const packageNames = new Set<string>();
  for (const { name } of disables) {
    extensionNames.add(name);
    packageNames.add(name);
    const extensionName = FIRST_PARTY_BUILTIN_PACKAGE_TO_EXTENSION.get(name);
    if (extensionName) extensionNames.add(extensionName);
    const packageName = FIRST_PARTY_BUILTIN_EXTENSION_TO_PACKAGE.get(name);
    if (packageName) packageNames.add(packageName);
  }
  return { extensionNames, packageNames };
}

function isDeferredBuiltinPackageHit(
  hit: PackageLoadCandidate,
  ordinaryBuiltinExtensionNames: ReadonlySet<string>,
): boolean {
  const extensionName = FIRST_PARTY_BUILTIN_PACKAGE_TO_EXTENSION.get(hit.packageName);
  return extensionName !== undefined && !ordinaryBuiltinExtensionNames.has(extensionName);
}

/**
 * Run the full extension pipeline against a resolved project config.
 *
 * Pipeline:
 *   1. Split `config.extensions` into resolved entries and disable directives.
 *   2. Discover extensions from package, project, and local sources.
 *   3. Omit explicit-only discovered extensions and skip loading factories
 *      for package- and project-source extensions whose names appear in the
 *      disable set (local-file names are not reliable pre-load and are
 *      filtered after `mergeExtensions`).
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
    } else if (isFirstPartyDeclarationMarker(entry)) {
      logger.warn(
        `Extension "${entry.name}" is declared in the project config, but this runtime ` +
          `provides the capability itself; the declaration is ignored.`,
      );
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
  const disabled = buildDisableFilters(disables);
  // First-party deferred packages stay lazy even when a reduced caller omits
  // their candidate. Ordinary builtins are exempt so package discovery keeps
  // its documented priority over direct builtin entries with the same name.
  const ordinaryBuiltinExtensionNames = new Set(
    (options.builtinExtensions ?? [])
      .filter((entry) => getDeferredExtensionState(entry) === undefined)
      .map((entry) => entry.extension.name),
  );

  let packageHits: PackageLoadCandidate[];
  let projectHits: ProjectLoadCandidate[];
  let localPaths: string[];
  if (options.discovery) {
    const [discoveredPackages, projectPaths, discoveredLocalPaths] = await Promise.all([
      disc.discoverPackageExtensions(projectDir),
      disc.discoverProjectExtensions(projectDir),
      disc.discoverLocalExtensions(projectDir),
    ]);
    packageHits = discoveredPackages.map((hit) => ({
      packageName: hit.packageName,
      metadata: hit.metadata,
      target: { path: hit.importTarget },
    }));
    projectHits = projectPaths.map((path) => ({
      extensionName: projectExtensionNameFromPath(path),
      target: { path },
    }));
    localPaths = discoveredLocalPaths;
  } else {
    const [discoveredPackages, discoveredProjects, discoveredLocalPaths] = await Promise.all([
      defaultDiscovery.discoverBoundPackageExtensions(projectDir),
      defaultDiscovery.discoverBoundProjectExtensions(projectDir),
      defaultDiscovery.discoverLocalExtensions(projectDir),
    ]);
    packageHits = discoveredPackages.map((hit) => ({
      packageName: hit.packageName,
      metadata: hit.metadata,
      target: { path: hit.binding.path, binding: hit.binding },
    }));
    projectHits = discoveredProjects.map((hit) => ({
      extensionName: hit.extensionName,
      target: { path: hit.binding.path, binding: hit.binding },
    }));
    localPaths = discoveredLocalPaths;
  }

  // Package hits retain the lexical name for disable directives, but loading
  // uses the canonical target captured while that package manifest was read.
  // This prevents an import map from redirecting the authorized package name.
  const enabledPackageTargets = packageHits
    .filter((hit) => defaultDiscovery.resolvePackageActivation(hit.metadata) === "auto")
    .filter((hit) =>
      !disabled.packageNames.has(hit.packageName) &&
      !disabled.extensionNames.has(hit.packageName) &&
      !isDeferredBuiltinPackageHit(hit, ordinaryBuiltinExtensionNames)
    )
    .map((hit) => hit.target);

  // Project paths have the shape `<projectDir>/extensions/<name>/src/index.ts`
  // (or `<projectDir>/extensions/<name>/index.ts`). `mergeExtensions` is the
  // safety net for any path whose name cannot be derived.
  const enabledProjectTargets = projectHits
    .filter((hit) =>
      hit.extensionName === undefined || !disabled.extensionNames.has(hit.extensionName)
    )
    .map((hit) => hit.target);

  // Local-file paths cannot be reliably filtered pre-load: the filename
  // (`foo.extension.ts`) is not guaranteed to match the extension name
  // declared by the factory. `mergeExtensions` applies the post-hoc filter.
  const packageResolved = await loadAllFactories(
    enabledPackageTargets,
    "package",
    loadFactory,
  );
  const projectResolved = await loadAllFactories(
    enabledProjectTargets,
    "project",
    loadFactory,
  );
  const localResolved = await loadAllFactories(
    localPaths.map((path) => ({ path })),
    "local-file",
    loadFactory,
  );

  const merged = disc.mergeExtensions(
    configResolved,
    packageResolved,
    projectResolved,
    localResolved,
    [...disabled.extensionNames].map((name) => ({ name, enabled: false as const })),
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
      beforeTransition: async () => {
        // A failed candidate already owns the fail-closed transition fence.
        // Finish its late cleanup before the replacement acquires a new fence.
        const failed = failedCandidate;
        if (failed) {
          await failed.awaitLateSetupCleanup();
          if (failedCandidate === failed) failedCandidate = undefined;
        }
      },
      beforeActivate: async () => {
        // Candidate discovery, factory loading, flattening, validation,
        // conflict checks, and topology all completed before this hook. The
        // new transition fence is active before old-generation teardown.
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
  targets: FactoryLoadTarget[],
  source: ExtensionSource,
  loadFactory: typeof defaultLoadFactory,
): Promise<ResolvedExtension[]> {
  const resolved: ResolvedExtension[] = [];
  for (const target of targets) {
    resolved.push(await loadFactory(target.path, source, undefined, target.binding));
  }
  return resolved;
}
