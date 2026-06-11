/**
 * Extension loader — topological sort, lifecycle management, preset flattening.
 *
 * @module extensions/loader
 */

import {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_SETUP_TIMEOUT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "./errors.ts";
import { register, reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import { auditCapabilities } from "./capabilities.ts";
import { detectConflicts, selectContractProviders, validateExtension } from "./validation.ts";
import type { Extension, ExtensionContext, ExtensionLogger, ResolvedExtension } from "./types.ts";

const DEFAULT_SETUP_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_SENTINEL = Symbol("extension-setup-timeout");

/** Options for {@link ExtensionLoader.setupAll}. */
export interface SetupAllOptions {
  /**
   * Per-extension setup() timeout in milliseconds.
   * Defaults to 30 000 ms. Pass `0` to disable.
   */
  setupTimeoutMs?: number;
}

/** Implement extension loader. */
export class ExtensionLoader {
  private logger: ExtensionLogger;
  private setupOrder: ResolvedExtension[] = [];
  private primed: Record<string, unknown> = {};

  /**
   * Register contracts that will be re-applied after each `setupAll()`
   * teardown pass. Used by `orchestrateExtensions()` to seed infrastructure
   * (e.g. `LLMProviderRegistry`) before per-extension `setup()` runs.
   */
  primeContracts(contracts: Record<string, unknown>): void {
    this.primed = { ...this.primed, ...contracts };
  }

  constructor(logger: ExtensionLogger) {
    this.logger = logger;
  }

  /**
   * Flatten presets: extensions with `extends` are replaced by their children.
   * Recurses through nested presets; throws on cyclic `extends` graphs rather
   * than stack-overflowing.
   */
  flattenPresets(extensions: ResolvedExtension[]): ResolvedExtension[] {
    return this.flattenPresetsInner(extensions, new Set());
  }

  private flattenPresetsInner(
    extensions: ResolvedExtension[],
    path: Set<Extension>,
  ): ResolvedExtension[] {
    const result: ResolvedExtension[] = [];

    for (const resolved of extensions) {
      const ext = resolved.extension;
      if (ext.extends && ext.extends.length > 0) {
        if (path.has(ext)) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: `Circular preset extends chain detected via "${ext.name}"`,
          });
        }
        path.add(ext);
        const children = ext.extends.map((child) => ({
          extension: child,
          source: resolved.source,
          origin: resolved.origin,
        }));
        result.push(...this.flattenPresetsInner(children, path));
        path.delete(ext);
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

      for (const contract of providedContractNames(ext)) {
        providerOf.set(contract, ext.name);
      }

      const contracts = requiredContractNames(ext);
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

    if (sorted.length !== extByName.size) {
      const unsorted = [...extByName.values()]
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
    options?: SetupAllOptions,
  ): Promise<void> {
    const timeoutMs = options?.setupTimeoutMs === 0
      ? 0
      : (options?.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS);
    // Idempotent: teardownAll clears setupOrder and resets the contract
    // registry even when nothing is loaded yet.
    await this.teardownAll();

    for (const [name, impl] of Object.entries(this.primed)) {
      register(name, impl);
    }

    const loadOrder = this.topologicalSort(this.flattenPresets(extensions));

    // Check for contract conflicts before loading
    const conflicts = detectConflicts(loadOrder);
    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => `"${c.contract}" provided by: ${c.providers.map((p) => p.name).join(", ")}`)
        .join("; ");
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Extension conflicts detected: ${details}`,
      });
    }

    // Precompute the priority winner per contract so that a lower-priority
    // provider later in the iteration order cannot overwrite the winning impl
    // via register(). Without this, merged inputs (config -> package ->
    // project -> local-file) silently invert the documented source priority.
    const contractWinner = selectContractProviders(loadOrder);

    for (const resolved of loadOrder) {
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
          if (contractWinner.get(contract) === resolved) {
            register(contract, impl);
          }
        }
      }

      if (ext.setup) {
        // Once setup fails (notably on timeout, where the losing promise may
        // resume later), the context must stop mutating the contract registry,
        // or a late provide() would poison state after teardownAll() rollback.
        let ctxRevoked = false;
        const ctx: ExtensionContext = {
          get: <T>(contract: string) => tryResolve<T>(contract),
          require: <T>(contract: string) => resolveContract<T>(contract),
          provide: <T>(contract: string, impl: T) => {
            if (ctxRevoked) {
              this.logger.warn(
                `Ignoring provide("${contract}") from "${ext.name}": its setup() already failed or timed out`,
              );
              return;
            }
            const winner = contractWinner.get(contract);
            if (!winner || winner === resolved) {
              register(contract, impl);
            }
          },
          config: projectConfig,
          logger: this.logger,
        };
        try {
          if (timeoutMs > 0) {
            let timerId: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timerId = setTimeout(() => reject(SETUP_TIMEOUT_SENTINEL), timeoutMs);
            });
            try {
              await Promise.race([ext.setup(ctx), timeoutPromise]);
            } finally {
              clearTimeout(timerId);
            }
          } else {
            await ext.setup(ctx);
          }
        } catch (err) {
          ctxRevoked = true;
          const normalized = err === SETUP_TIMEOUT_SENTINEL
            ? EXTENSION_SETUP_TIMEOUT_ERROR.create({
              message: `Extension "${ext.name}" setup() timed out after ${timeoutMs}ms`,
              detail: `Extension "${ext.name}" setup() did not complete within ${timeoutMs}ms`,
            })
            : err;
          // Best-effort teardown of the partially-initialized extension so
          // any resources it opened before throwing get a chance to close.
          if (ext.teardown) {
            try {
              await ext.teardown();
            } catch (teardownErr) {
              this.logger.error(
                `Error during rollback teardown of "${ext.name}":`,
                teardownErr,
              );
            }
          }
          // Roll back everything loaded so far and clear the registry.
          await this.teardownAll();
          throw normalized;
        }
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
    const hadSetupExtensions = this.setupOrder.length > 0;
    this.setupOrder = [];
    // Only clear the contract registry when this loader actually registered
    // contracts via setupAll(). Otherwise an idempotent teardown on an empty
    // loader would wipe contracts registered out-of-band (e.g. by the test
    // harness in `tests/_helpers/contract-init.ts`).
    if (hadSetupExtensions) reset();
  }
}

function providedContractNames(ext: Extension): string[] {
  const names = new Set<string>();
  for (const contract of Object.keys(ext.provides ?? {})) {
    names.add(contract);
  }
  for (const contract of ext.contracts?.provides ?? []) {
    names.add(contract);
  }
  return [...names];
}

function requiredContractNames(ext: Extension): string[] {
  return ext.contracts?.requires ?? [];
}
