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

type CacheExtensionModule = Readonly<{ default: ExtensionFactory }>;

const CACHE_EXTENSION_SOURCE_DIRECTORY = "ext-cache-redis";
const CACHE_EXTENSION_PACKAGE_NAME = "@veryfront/ext-cache-redis";

/**
 * Activate the standalone proxy's explicitly selected cache extension.
 * Memory mode performs no extension import. The returned loader owns provider
 * teardown; the proxy borrows its registered `TokenCacheStore`.
 */
export async function activateStandaloneProxyCacheExtension(): Promise<ExtensionLoader | null> {
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "extension") {
    throw new TypeError("CACHE_TYPE must be memory or extension");
  }
  if (cacheType === "memory") return null;

  const module = await importFirstPartyExtensionModule<CacheExtensionModule>(
    CACHE_EXTENSION_SOURCE_DIRECTORY,
    CACHE_EXTENSION_PACKAGE_NAME,
  );
  if (typeof module.default !== "function") {
    throw new TypeError(`${CACHE_EXTENSION_PACKAGE_NAME} must export an ExtensionFactory`);
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
