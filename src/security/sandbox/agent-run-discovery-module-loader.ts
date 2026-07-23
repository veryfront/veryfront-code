import type { DiscoveryModuleImporter, FileDiscoveryContext } from "#veryfront/discovery/types.ts";
import { discoveryFileUrlToPath } from "#veryfront/discovery/file-discovery.ts";
import {
  runWithSharedRegistryMutationsDisabled,
} from "#veryfront/registry/project-scoped-registry-manager.ts";
import type { AgentRunExecutionModule } from "./agent-run-worker-contract.ts";
import { normalizeProjectSourcePath } from "./project-source-snapshot.ts";

function assertDedicatedWorkerRealm(): void {
  const scopeConstructor = Reflect.get(globalThis, "DedicatedWorkerGlobalScope") as
    | (new (...args: never[]) => object)
    | undefined;
  if (
    typeof scopeConstructor !== "function" ||
    !(globalThis instanceof scopeConstructor)
  ) {
    throw new TypeError("Agent discovery module loading requires a dedicated Worker realm");
  }
}

function moduleMap(modules: readonly AgentRunExecutionModule[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const module of modules) {
    const normalized = normalizeProjectSourcePath(module.sourcePath, "/", true);
    if (normalized !== module.sourcePath || result.has(normalized)) {
      throw new TypeError("Agent discovery compiled module map is invalid");
    }
    if (typeof module.moduleCode !== "string" || module.moduleCode.length === 0) {
      throw new TypeError("Agent discovery compiled module map is invalid");
    }
    result.set(normalized, module.moduleCode);
  }
  return result;
}

/**
 * Create a fail-closed discovery importer backed only by compiled modules from
 * one verified immutable source snapshot. There is no filesystem fallback.
 */
export function createAgentRunDiscoveryModuleImporter(
  modules: readonly AgentRunExecutionModule[],
): DiscoveryModuleImporter {
  assertDedicatedWorkerRealm();
  const codeByPath = moduleMap(modules);

  return async (file: string, context: FileDiscoveryContext): Promise<unknown> => {
    const rawPath = discoveryFileUrlToPath(file, context);
    const sourcePath = normalizeProjectSourcePath(rawPath, "/", true);
    if (sourcePath !== rawPath.replaceAll("\\", "/")) {
      throw new TypeError("Agent discovery module path is not canonical");
    }
    const moduleCode = codeByPath.get(sourcePath);
    if (moduleCode === undefined) {
      throw new TypeError("Agent discovery module is absent from the immutable compiled map");
    }

    const moduleUrl = URL.createObjectURL(
      new Blob([moduleCode], { type: "text/javascript" }),
    );
    try {
      return await runWithSharedRegistryMutationsDisabled(
        () => import(moduleUrl) as Promise<Record<string, unknown>>,
      );
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  };
}
