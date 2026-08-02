/**
 * Standalone proxy extension composition.
 *
 * This CLI/deployment boundary activates provider implementations before the
 * provider-neutral proxy runtime is imported. Core consumes only the
 * `TokenCacheStore` contract published by the extension loader.
 */

import { cliLogger } from "#cli/utils";
import { type ExtensionFactory, ExtensionLoader } from "veryfront/extensions";
import { importFirstPartyExtensionModule } from "veryfront/extensions/first-party-import";
import { getEnv } from "veryfront/platform";
import {
  createProxyShutdownAggregateError,
  type RegisterProxyShutdownHook,
  registerProxyShutdownHook,
} from "veryfront/proxy/shutdown-hooks";

type CacheExtensionModule = Readonly<{ default: ExtensionFactory }>;

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

/**
 * Activate the standalone proxy's explicitly selected cache extension.
 * Memory mode performs no extension import. The returned loader owns provider
 * teardown; the proxy borrows its registered `TokenCacheStore`.
 */
async function activateStandaloneProxyCacheExtensionInternal(): Promise<ExtensionLoader | null> {
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "extension") {
    throw new NativeTypeError("CACHE_TYPE must be memory or extension");
  }
  if (cacheType === "memory") return null;

  const module = await importFirstPartyExtensionModule<CacheExtensionModule>(
    CACHE_EXTENSION_SOURCE_DIRECTORY,
    CACHE_EXTENSION_PACKAGE_NAME,
  );
  if (typeof module.default !== "function") {
    throw new NativeTypeError(`${CACHE_EXTENSION_PACKAGE_NAME} must export an ExtensionFactory`);
  }

  const loader = new ExtensionLoader(cliLogger);
  try {
    await loader.setupAll(
      [{
        extension: module.default(),
        source: "config",
        origin: "standalone proxy cache selection",
      }],
      {},
    );
    return loader;
  } catch (error) {
    try {
      await loader.teardownAll();
    } catch (cleanupError) {
      cliLogger.error("Failed to clean up standalone proxy cache extension", cleanupError);
    }
    throw error;
  }
}

/** Start explicit standalone cache composition with a pinned lifecycle promise. */
export function activateStandaloneProxyCacheExtension(): Promise<ExtensionLoader | null> {
  return pinCompositionPromise(activateStandaloneProxyCacheExtensionInternal());
}

async function registerStandaloneProxyCacheExtensionTeardownInternal(
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
        "Failed to register and clean up standalone proxy cache extension teardown",
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
            "Failed to unregister and tear down standalone proxy cache extension",
          );
        }
        throw teardownError;
      }
      if (disposalFailed) throw disposalError;
    })());
}

/** Register exactly-once provider teardown with the proxy's shutdown owner. */
export function registerStandaloneProxyCacheExtensionTeardown(
  loader: ExtensionLoader | null,
  registerHook: RegisterProxyShutdownHook = registerProxyShutdownHook,
): Promise<() => Promise<void>> {
  return pinCompositionPromise(
    registerStandaloneProxyCacheExtensionTeardownInternal(loader, registerHook),
  );
}
