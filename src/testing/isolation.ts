/**
 * Test isolation utilities for cross-runtime execution.
 *
 * Provides default cleanup hooks to reduce cross-test leakage,
 * especially in Bun where module caching and shared globals
 * can cause flakiness.
 *
 * @module
 */

import { isBun } from "#veryfront/platform/compat/runtime.ts";

type CleanupTask = () => void | Promise<void>;

const cleanupTasks = new Set<CleanupTask>();

export function registerTestCleanup(task: CleanupTask): void {
  cleanupTasks.add(task);
}

/**
 * Comprehensive reset of ALL test state across the application.
 *
 * This function clears all known caches and singletons that can cause
 * test isolation issues when running tests in parallel. It should be
 * called at the start and end of each test to ensure clean state.
 *
 * Includes:
 * - Config state (_environmentConfig, runtimeConfig, configCache)
 * - Layout discovery cache
 * - SSR module caches
 * - React cache and compat hooks
 * - Snippet cache
 * - API handler state
 * - Reload notifier
 */
export async function resetAllTestState(): Promise<void> {
  const cleanups: Array<() => Promise<void> | void> = [
    // Config state - CRITICAL for test isolation
    async () => {
      const { clearConfigCache } = await import("../config/loader.ts");
      clearConfigCache();
    },
    async () => {
      const { _resetEnvironmentConfig } = await import("../config/environment-config.ts");
      _resetEnvironmentConfig();
    },
    async () => {
      const { _resetRuntimeConfig } = await import("../config/runtime-config.ts");
      _resetRuntimeConfig();
    },

    // Layout discovery cache - prevents stale layouts across tests
    async () => {
      const { clearLayoutDiscoveryCache } = await import(
        "../rendering/layouts/utils/discovery.ts"
      );
      clearLayoutDiscoveryCache();
    },

    // SSR module caches
    async () => {
      const { clearSSRModuleCache } = await import("#veryfront/modules");
      clearSSRModuleCache();
    },

    // React cache and compat hooks
    async () => {
      const { resetReactCache } = await import("../react/compat/ssr-adapter/server-loader.ts");
      resetReactCache();
    },
    async () => {
      const { resetCompatHooksContext } = await import("../react/compat/hooks-adapter.ts");
      resetCompatHooksContext();
    },

    // Snippet cache
    async () => {
      const { clearSnippetCache } = await import("../rendering/snippet-renderer.ts");
      clearSnippetCache();
    },

    // API handler state
    async () => {
      const { resetApiHandler } = await import("../server/handlers/request/api/index.ts");
      await resetApiHandler();
    },

    // Reload notifier
    async () => {
      const { ReloadNotifier } = await import("../server/reload-notifier.ts");
      ReloadNotifier.reset();
    },

    // HTTP module in-flight fetches - prevents test interference from shared promises
    async () => {
      const { __clearInFlightHttpFetches } = await import("../transforms/esm/http-cache.ts");
      __clearInFlightHttpFetches();
    },
  ];

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      console.debug("resetAllTestState cleanup task failed", error);
    }
  }

  // Bun-specific cleanup
  if (isBun) {
    try {
      const { cleanupBundler } = await import("../rendering/cleanup.ts");
      await cleanupBundler();
    } catch (error) {
      console.debug("resetAllTestState bundler cleanup failed", error);
    }
  }
}
