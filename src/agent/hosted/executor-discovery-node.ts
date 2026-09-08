import { realpath } from "node:fs/promises";
import { clearConfigCache, getConfig } from "#veryfront/config";
import { bindExecutorDiscoveryRoots } from "#veryfront/agent/hosted/executor-discovery-roots.ts";
import { clearRegistryScope } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { discoverProjectAgentRuntime } from "#veryfront/agent/project/agent-runtime.ts";
import { nodeAdapter } from "#veryfront/platform/adapters/node.ts";
import type { ExecutorDiscoveryBackend } from "./executor-discovery.ts";
import { ExecutorDiscoveryError } from "./executor-discovery-schema.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";

let activeOwner: object | undefined;

/** Executor-only default backend. Its module is loaded on the first metadata operation. */
export function createNodeExecutorDiscoveryBackend(
  input: { projectDir: string; cacheKey: string },
): ExecutorDiscoveryBackend {
  const owner = {};
  let claimed = false;
  return {
    async load(signal) {
      signal.throwIfAborted();
      // This backend owns a dedicated process's default registry namespace.
      // It does not invent an application project to obtain a registry scope.
      if (activeOwner || tryGetRegistryScopeId() !== null) {
        throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_BUSY");
      }
      activeOwner = owner;
      claimed = true;
      const config = await getConfig(input.projectDir, nodeAdapter, { cacheKey: input.cacheKey });
      const projectDir = await realpath(input.projectDir);
      const boundConfig = await bindExecutorDiscoveryRoots(projectDir, config, realpath);
      signal.throwIfAborted();
      return discoverProjectAgentRuntime({
        projectDir,
        cacheKey: input.cacheKey,
        adapter: nodeAdapter,
        // Application storage configuration does not select the executor's
        // source filesystem. Preserve discovery paths/policy in a local copy.
        config: boundConfig,
        allowHostProjectCodeExecution: true,
      });
    },
    async cleanup() {
      if (!claimed) return;
      claimed = false;
      let failed = false;
      const bundler = tryResolve<Bundler>("Bundler");
      try {
        for (
          const clean of [
            () => clearRegistryScope("__default__"),
            clearTranspileCache,
            clearConfigCache,
          ]
        ) {
          try {
            clean();
          } catch {
            failed = true;
          }
        }
        try {
          await bundler?.stop?.();
        } catch {
          failed = true;
        }
      } finally {
        if (activeOwner === owner) activeOwner = undefined;
      }
      if (failed) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_CLEANUP_FAILED");
    },
  };
}
