/**
 * Extension loader — topological sort, lifecycle management, preset flattening.
 *
 * @module extensions/loader
 */

import {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "./errors.ts";
import { register, reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import { auditCapabilities } from "./capabilities.ts";
import { detectConflicts, validateExtension } from "./validation.ts";
import type { ExtensionContext, ExtensionLogger, ResolvedExtension } from "./types.ts";

export class ExtensionLoader {
  private logger: ExtensionLogger;
  private setupOrder: ResolvedExtension[] = [];

  constructor(logger: ExtensionLogger) {
    this.logger = logger;
  }

  /**
   * Flatten presets: extensions with `extends` are replaced by their children.
   */
  flattenPresets(extensions: ResolvedExtension[]): ResolvedExtension[] {
    const result: ResolvedExtension[] = [];

    for (const resolved of extensions) {
      const ext = resolved.extension;
      if (ext.extends && ext.extends.length > 0) {
        for (const child of ext.extends) {
          result.push({ extension: child, source: resolved.source, origin: resolved.origin });
        }
      } else {
        result.push(resolved);
      }
    }

    return result;
  }

  /**
   * Topological sort: providers load before consumers.
   * Throws on circular dependencies.
   */
  topologicalSort(extensions: ResolvedExtension[]): ResolvedExtension[] {
    const providerOf = new Map<string, string>();
    const extByName = new Map<string, ResolvedExtension>();
    const consumesContracts = new Map<string, string[]>();

    for (const resolved of extensions) {
      const ext = resolved.extension;
      extByName.set(ext.name, resolved);

      if (ext.provides) {
        for (const contract of Object.keys(ext.provides)) {
          providerOf.set(contract, ext.name);
        }
      }

      const contracts = ext.capabilities
        .filter((c) => c.type === "contract")
        .map((c) => c.name as string);
      if (contracts.length > 0) {
        consumesContracts.set(ext.name, contracts);
      }
    }

    // Build adjacency list
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const resolved of extensions) {
      const name = resolved.extension.name;
      if (!graph.has(name)) graph.set(name, new Set());
      if (!inDegree.has(name)) inDegree.set(name, 0);
    }

    for (const [consumer, contracts] of consumesContracts) {
      for (const contract of contracts) {
        const provider = providerOf.get(contract);
        if (provider && provider !== consumer) {
          const edges = graph.get(provider)!;
          if (!edges.has(consumer)) {
            edges.add(consumer);
            inDegree.set(consumer, (inDegree.get(consumer) || 0) + 1);
          }
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: ResolvedExtension[] = [];

    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(extByName.get(name)!);

      for (const dependent of graph.get(name) || []) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== extensions.length) {
      const unsorted = extensions
        .filter((r) => !sorted.includes(r))
        .map((r) => r.extension.name);
      throw CIRCULAR_DEPENDENCY_ERROR.create({
        message: `Circular extension dependency detected among: ${unsorted.join(", ")}`,
      });
    }

    return sorted;
  }

  /**
   * Run the full setup lifecycle for all extensions.
   * If called while extensions are already loaded, tears them down first.
   */
  async setupAll(
    extensions: ResolvedExtension[],
    projectConfig: Record<string, unknown>,
  ): Promise<void> {
    if (this.setupOrder.length > 0) {
      await this.teardownAll();
    }
    reset();
    this.setupOrder = [];

    // Check for contract conflicts before loading
    const conflicts = detectConflicts(extensions);
    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => `"${c.contract}" provided by: ${c.providers.map((p) => p.name).join(", ")}`)
        .join("; ");
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Extension conflicts detected: ${details}`,
      });
    }

    for (const resolved of extensions) {
      const ext = resolved.extension;

      const issues = validateExtension(ext);
      if (issues.length > 0) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Extension "${ext.name}" is invalid:\n  ${issues.join("\n  ")}`,
        });
      }

      auditCapabilities(ext.name, ext.capabilities, this.logger);

      if (ext.provides) {
        for (const [contract, impl] of Object.entries(ext.provides)) {
          register(contract, impl);
        }
      }

      if (ext.setup) {
        const ctx: ExtensionContext = {
          get: <T>(contract: string) => tryResolve<T>(contract),
          require: <T>(contract: string) => resolveContract<T>(contract),
          provide: <T>(contract: string, impl: T) => register(contract, impl),
          config: projectConfig,
          logger: this.logger,
        };
        await ext.setup(ctx);
      }

      this.setupOrder.push(resolved);
      this.logger.info(`Extension "${ext.name}" v${ext.version} loaded from ${resolved.source}`);
    }
  }

  /**
   * Teardown all loaded extensions in reverse order.
   */
  async teardownAll(): Promise<void> {
    const reversed = [...this.setupOrder].reverse();
    for (const resolved of reversed) {
      if (resolved.extension.teardown) {
        try {
          await resolved.extension.teardown();
        } catch (err) {
          this.logger.error(`Error tearing down "${resolved.extension.name}":`, err);
        }
      }
    }
    this.setupOrder = [];
    reset();
  }
}
