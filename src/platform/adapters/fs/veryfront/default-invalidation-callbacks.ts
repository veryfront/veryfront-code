import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import type { InvalidationCallbacks } from "./types.ts";
import {
  assertReadableConfigObject,
  invalidFSAdapterConfig,
  readConfigProperty,
} from "./config-boundary.ts";

const logger = baseLogger.component("default-invalidation-callbacks");

const CALLBACK_KEYS = [
  "clearSSRModuleCache",
  "clearSSRModuleCacheForProject",
  "clearRouterDetectionCacheForProject",
  "clearModulePathCache",
  "invalidateModulePaths",
  "clearSnippetCacheForProject",
  "triggerReload",
  "clearRendererCacheForProject",
  "clearProjectCSSCache",
  "clearDomainCache",
  "evictCurrentAdapter",
] as const satisfies readonly (keyof InvalidationCallbacks)[];

type CallbackName = (typeof CALLBACK_KEYS)[number];
type ModuleLoader = (specifier: string) => Promise<unknown>;

export interface DefaultInvalidationCallbackDependencies {
  readonly loadModule?: ModuleLoader;
  readonly reportFailure?: (callback: CallbackName, error: unknown) => void;
}

const callbackSnapshots = new WeakSet<object>();
const defaultCallbackSets = new WeakSet<object>();

function loadModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function safeErrorClass(error: unknown): string {
  try {
    if (error instanceof TypeError) return "type";
    if (error instanceof RangeError) return "range";
    if (error instanceof Error) return "error";
    return "non-error";
  } catch {
    return "unknown";
  }
}

function reportFailure(callback: CallbackName, error: unknown): void {
  logger.warn("Default invalidation callback failed", {
    callback,
    errorClass: safeErrorClass(error),
  });
}

function snapshotDependencies(
  dependencies: DefaultInvalidationCallbackDependencies | undefined,
): Required<DefaultInvalidationCallbackDependencies> {
  if (dependencies === undefined) {
    return Object.freeze({ loadModule, reportFailure });
  }

  assertReadableConfigObject(dependencies, "Default invalidation callback dependencies");
  const configuredLoader = readConfigProperty(
    dependencies,
    "loadModule",
    "Default invalidation callback dependencies",
  );
  const configuredReporter = readConfigProperty(
    dependencies,
    "reportFailure",
    "Default invalidation callback dependencies",
  );
  if (configuredLoader !== undefined && typeof configuredLoader !== "function") {
    invalidFSAdapterConfig("Default invalidation callback module loader must be a function");
  }
  if (configuredReporter !== undefined && typeof configuredReporter !== "function") {
    invalidFSAdapterConfig("Default invalidation callback failure reporter must be a function");
  }

  return Object.freeze({
    loadModule: (configuredLoader ?? loadModule) as ModuleLoader,
    reportFailure: (configuredReporter ?? reportFailure) as (
      callback: CallbackName,
      error: unknown,
    ) => void,
  });
}

function safelyReportFailure(
  reporter: DefaultInvalidationCallbackDependencies["reportFailure"],
  callback: CallbackName,
  error: unknown,
): void {
  try {
    reporter?.(callback, error);
  } catch (reportingError) {
    reportFailure(callback, reportingError);
  }
}

function runDetached(
  callback: CallbackName,
  operation: () => unknown,
  reporter: DefaultInvalidationCallbackDependencies["reportFailure"],
): void {
  try {
    void Promise.resolve(operation()).catch((error) => {
      safelyReportFailure(reporter, callback, error);
    });
  } catch (error) {
    safelyReportFailure(reporter, callback, error);
  }
}

function getModuleCallback(
  module: unknown,
  exportName: string,
): (...args: unknown[]) => unknown {
  if ((typeof module !== "object" && typeof module !== "function") || module === null) {
    throw new TypeError("Invalid invalidation callback module");
  }

  let callback: unknown;
  try {
    callback = Reflect.get(module, exportName);
  } catch {
    throw new TypeError("Invalid invalidation callback module");
  }
  if (typeof callback !== "function") {
    throw new TypeError("Invalid invalidation callback module export");
  }
  return callback as (...args: unknown[]) => unknown;
}

function invokeModuleCallback(
  loader: ModuleLoader,
  specifier: string,
  exportName: string,
  args: unknown[] = [],
): Promise<unknown> {
  return Promise.resolve(loader(specifier)).then((module) => {
    const callback = getModuleCallback(module, exportName);
    return Reflect.apply(callback, module, args);
  });
}

export function snapshotInvalidationCallbacks(
  callbacks: InvalidationCallbacks | undefined,
): Readonly<InvalidationCallbacks> | undefined {
  if (callbacks === undefined) return undefined;
  if (
    typeof callbacks === "object" && callbacks !== null &&
    (callbackSnapshots.has(callbacks) || defaultCallbackSets.has(callbacks))
  ) {
    return callbacks;
  }

  assertReadableConfigObject(callbacks, "Filesystem invalidation callbacks");
  const snapshot: Record<string, unknown> = {};
  for (const key of CALLBACK_KEYS) {
    const callback = readConfigProperty(callbacks, key, "Filesystem invalidation callbacks");
    if (callback !== undefined && typeof callback !== "function") {
      invalidFSAdapterConfig("Filesystem invalidation callbacks must be functions");
    }
    if (callback !== undefined) snapshot[key] = callback;
  }

  const frozen = Object.freeze(snapshot) as Readonly<InvalidationCallbacks>;
  callbackSnapshots.add(frozen);
  return frozen;
}

export function createDefaultInvalidationCallbacks(
  callbacks?: InvalidationCallbacks,
  dependencies?: DefaultInvalidationCallbackDependencies,
): Readonly<InvalidationCallbacks> {
  if (
    typeof callbacks === "object" && callbacks !== null && defaultCallbackSets.has(callbacks)
  ) {
    return callbacks;
  }

  const overrides = snapshotInvalidationCallbacks(callbacks);
  const deps = snapshotDependencies(dependencies);
  const defaults: InvalidationCallbacks = {
    clearSSRModuleCache: () => {
      runDetached(
        "clearSSRModuleCache",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
            "clearSSRModuleCache",
          ),
        deps.reportFailure,
      );
    },
    clearModulePathCache: () => {
      runDetached(
        "clearModulePathCache",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
            "clearModulePathCache",
          ),
        deps.reportFailure,
      );
    },
    invalidateModulePaths: (changedPaths: string[]) => {
      const paths = Array.from(changedPaths);
      runDetached(
        "invalidateModulePaths",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts",
            "invalidateModulePaths",
            [paths],
          ),
        deps.reportFailure,
      );
    },
    clearSSRModuleCacheForProject: (projectId: string) => {
      runDetached(
        "clearSSRModuleCacheForProject",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts",
            "clearSSRModuleCacheForProject",
            [projectId],
          ),
        deps.reportFailure,
      );
    },
    clearRouterDetectionCacheForProject: (projectId: string) => {
      runDetached(
        "clearRouterDetectionCacheForProject",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/rendering/router-detection.ts",
            "clearRouterDetectionCacheForProject",
            [projectId],
          ),
        deps.reportFailure,
      );
    },
    clearSnippetCacheForProject: (projectSlug: string) => {
      runDetached(
        "clearSnippetCacheForProject",
        () =>
          invokeModuleCallback(
            deps.loadModule,
            "#veryfront/rendering/snippet-renderer.ts",
            "clearSnippetCacheForProject",
            [projectSlug],
          ),
        deps.reportFailure,
      );
    },
    clearRendererCacheForProject: async (projectId: string) => {
      await invokeModuleCallback(
        deps.loadModule,
        "#veryfront/rendering/renderer.ts",
        "clearRendererCacheForProject",
        [projectId],
      );
    },
  };

  if (overrides) {
    for (const key of CALLBACK_KEYS) {
      const callback = overrides[key];
      if (callback !== undefined) {
        (defaults as Record<CallbackName, unknown>)[key] = callback;
      }
    }
  }

  const normalized = Object.freeze(defaults);
  defaultCallbackSets.add(normalized);
  return normalized;
}
