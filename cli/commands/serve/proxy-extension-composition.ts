/**
 * Standalone proxy extension composition.
 *
 * This CLI/deployment boundary activates provider implementations before the
 * provider-neutral proxy runtime is imported. Core consumes only the
 * `TokenCacheStore` contract published by the extension loader.
 */

import { cliLogger } from "veryfront/utils/logger";
import { type ExtensionFactory, ExtensionLoader } from "veryfront/extensions";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
import { getEnv, setEnv } from "veryfront/platform/env";
import {
  createProxyShutdownAggregateError,
  type RegisterProxyShutdownHook,
  registerProxyShutdownHook,
} from "veryfront/proxy/shutdown-hooks";

type ProxyExtensionModule = Readonly<{ default: ExtensionFactory }>;

// This module is evaluated before extension activation. Pin promises created
// by the later teardown path so extension code cannot replace Promise species
// or prototype hooks underneath CLI-owned lifecycle work.
const NativePromise = Promise;
const NativeTypeError = TypeError;
const createObject = Object.create;
const defineProperty = Object.defineProperty;

function pinCompositionPromise<T>(promise: Promise<T>): Promise<T> {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = false;
  descriptor.value = NativePromise;
  descriptor.writable = false;
  defineProperty(promise, "constructor", descriptor);
  return promise;
}

const resolvedBeforeExtensionActivation = pinCompositionPromise(
  new NativePromise<void>((resolve) => resolve()),
);

const CACHE_EXTENSION_SOURCE_DIRECTORY = "ext-cache-redis";
const CACHE_EXTENSION_PACKAGE_NAME = "@veryfront/ext-cache-redis";
const REDIS_EXTENSION_SOURCE_DIRECTORY = "ext-redis";
const REDIS_EXTENSION_PACKAGE_NAME = "@veryfront/ext-redis";

/**
 * Activate the standalone proxy's explicitly selected cache and Redis runtime
 * providers. The returned loader owns provider teardown.
 */
async function activateStandaloneProxyExtensionsInternal(): Promise<ExtensionLoader | null> {
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "extension" && cacheType !== "redis") {
    throw new NativeTypeError("CACHE_TYPE must be memory, extension, or redis");
  }

  const selected: Array<{
    origin: string;
    packageName: string;
    sourceDirectory: string;
  }> = [];
  if (cacheType === "extension" || cacheType === "redis") {
    selected.push({
      origin: "standalone proxy cache selection",
      packageName: CACHE_EXTENSION_PACKAGE_NAME,
      sourceDirectory: CACHE_EXTENSION_SOURCE_DIRECTORY,
    });
  }
  if (getEnv("REDIS_URL")) {
    selected.push({
      origin: "standalone proxy routing invalidation",
      packageName: REDIS_EXTENSION_PACKAGE_NAME,
      sourceDirectory: REDIS_EXTENSION_SOURCE_DIRECTORY,
    });
  }
  if (selected.length === 0) return null;

  const extensions = await NativePromise.all(selected.map(async (definition) => {
    const module = await importFirstPartyExtensionModule<ProxyExtensionModule>(
      definition.sourceDirectory,
      definition.packageName,
    );
    if (typeof module.default !== "function") {
      throw new NativeTypeError(`${definition.packageName} must export an ExtensionFactory`);
    }
    return {
      extension: module.default(),
      source: "config" as const,
      origin: definition.origin,
    };
  }));

  const loader = new ExtensionLoader(cliLogger);
  try {
    await loader.setupAll(extensions, {});
    // Keep the chart compatible with older universal binaries during rollout.
    // The dedicated entrypoint translates the legacy value only after the
    // extension-backed store is registered.
    if (cacheType === "redis") setEnv("CACHE_TYPE", "extension");
    return loader;
  } catch (error) {
    try {
      await loader.teardownAll();
    } catch (cleanupError) {
      cliLogger.error("Failed to clean up standalone proxy extensions", cleanupError);
    }
    throw error;
  }
}

/** Start explicit standalone proxy extension composition. */
export function activateStandaloneProxyExtensions(): Promise<ExtensionLoader | null> {
  return pinCompositionPromise(activateStandaloneProxyExtensionsInternal());
}

async function registerStandaloneProxyExtensionTeardownInternal(
  loader: ExtensionLoader | null,
  registerHook: RegisterProxyShutdownHook,
): Promise<() => Promise<void>> {
  if (!loader) return () => resolvedBeforeExtensionActivation;

  let teardownPromise: Promise<void> | null = null;
  const teardown = (): Promise<void> => {
    teardownPromise ??= pinCompositionPromise((async () => {
      // Suspend before entering extension code so teardownPromise owns
      // reentrant calls before loader teardown can begin.
      await resolvedBeforeExtensionActivation;
      await loader.teardownAll();
    })());
    return teardownPromise;
  };
  let disposeHook: () => void;
  try {
    disposeHook = registerHook(teardown);
  } catch (error) {
    try {
      await teardown();
    } catch (cleanupError) {
      throw createProxyShutdownAggregateError(
        [error, cleanupError],
        "Failed to register and clean up standalone proxy extension teardown",
      );
    }
    throw error;
  }

  return () =>
    pinCompositionPromise((async () => {
      let disposalFailed = false;
      let disposalError: unknown;
      try {
        disposeHook();
      } catch (error) {
        disposalFailed = true;
        disposalError = error;
      }

      try {
        await teardown();
      } catch (teardownError) {
        if (disposalFailed) {
          throw createProxyShutdownAggregateError(
            [disposalError, teardownError],
            "Failed to unregister and tear down standalone proxy extensions",
          );
        }
        throw teardownError;
      }
      if (disposalFailed) throw disposalError;
    })());
}

/** Register exactly-once provider teardown with the proxy's shutdown owner. */
export function registerStandaloneProxyExtensionTeardown(
  loader: ExtensionLoader | null,
  registerHook: RegisterProxyShutdownHook = registerProxyShutdownHook,
): Promise<() => Promise<void>> {
  return pinCompositionPromise(
    registerStandaloneProxyExtensionTeardownInternal(loader, registerHook),
  );
}
