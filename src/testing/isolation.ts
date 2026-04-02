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
type LabeledCleanupTask = {
  label: string;
  task: CleanupTask;
};

const cleanupTasks = new Set<CleanupTask>();

export function registerTestCleanup(task: CleanupTask): void {
  cleanupTasks.add(task);
}

async function runBestEffortCleanups(cleanups: Iterable<LabeledCleanupTask>): Promise<void> {
  for (const { label, task } of cleanups) {
    try {
      await task();
    } catch (error) {
      console.debug(`resetAllTestState ${label} failed`, error);
    }
  }
}

async function runRegisteredCleanups(): Promise<void> {
  const tasks = Array.from(cleanupTasks);
  cleanupTasks.clear();

  await runBestEffortCleanups(
    tasks.map((task) => ({
      label: "registered cleanup",
      task,
    })),
  );
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
  await runRegisteredCleanups();

  const cleanupSteps: LabeledCleanupTask[] = [
    // Config state - CRITICAL for test isolation
    {
      label: "config cache cleanup",
      task: async () => {
        const { clearConfigCache } = await import("../config/loader.ts");
        clearConfigCache();
      },
    },
    {
      label: "environment config cleanup",
      task: async () => {
        const { _resetEnvironmentConfig } = await import("../config/environment-config.ts");
        _resetEnvironmentConfig();
      },
    },
    {
      label: "runtime config cleanup",
      task: async () => {
        const { _resetRuntimeConfig } = await import("../config/runtime-config.ts");
        _resetRuntimeConfig();
      },
    },

    // Layout discovery cache - prevents stale layouts across tests
    {
      label: "layout discovery cleanup",
      task: async () => {
        const { clearLayoutDiscoveryCache } = await import(
          "../rendering/layouts/utils/discovery.ts"
        );
        clearLayoutDiscoveryCache();
      },
    },

    // SSR module caches
    {
      label: "SSR module cache cleanup",
      task: async () => {
        const { clearSSRModuleCache } = await import("#veryfront/modules");
        clearSSRModuleCache();
      },
    },

    // React cache and compat hooks
    {
      label: "React cache cleanup",
      task: async () => {
        const { resetReactCache } = await import("../react/compat/ssr-adapter/server-loader.ts");
        resetReactCache();
      },
    },
    {
      label: "compat hooks cleanup",
      task: async () => {
        const { resetCompatHooksContext } = await import("../react/compat/hooks-adapter.ts");
        resetCompatHooksContext();
      },
    },

    // Snippet cache
    {
      label: "snippet cache cleanup",
      task: async () => {
        const { clearSnippetCache } = await import("../rendering/snippet-renderer.ts");
        clearSnippetCache();
      },
    },

    // API handler state
    {
      label: "API handler cleanup",
      task: async () => {
        const { resetApiHandler } = await import("../server/handlers/request/api/index.ts");
        await resetApiHandler();
      },
    },

    // Reload notifier
    {
      label: "reload notifier cleanup",
      task: async () => {
        const { ReloadNotifier } = await import("../server/reload-notifier.ts");
        ReloadNotifier.reset();
      },
    },

    // HTTP module in-flight fetches - prevents test interference from shared promises
    {
      label: "HTTP in-flight fetch cleanup",
      task: async () => {
        const { __clearInFlightHttpFetches } = await import("../transforms/esm/http-cache.ts");
        __clearInFlightHttpFetches();
      },
    },
  ];

  await runBestEffortCleanups(cleanupSteps);

  // Bun-specific cleanup
  if (isBun) {
    await runBestEffortCleanups([
      {
        label: "bundler cleanup",
        task: async () => {
          const { cleanupBundler } = await import("../rendering/cleanup.ts");
          await cleanupBundler();
        },
      },
    ]);
  }
}
