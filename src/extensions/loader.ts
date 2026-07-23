/**
 * Extension loader: topological sort, lifecycle management, preset flattening.
 *
 * @module extensions/loader
 */

import {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_SETUP_TIMEOUT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "./errors.ts";
import { register, resolve as resolveContract, tryResolve } from "./contracts.ts";
import {
  claimContractRegistryLifecycle,
  getContractRegistryLifecycleOwner,
  releaseContractRegistryLifecycle,
  restoreContracts,
  snapshotContracts,
} from "./contract-registry-state.ts";
import { auditCapabilities } from "./capabilities.ts";
import { snapshotProjectConfig, snapshotResolvedExtensions } from "./extension-snapshot.ts";
import {
  detectConflicts,
  selectContractProviders,
  validateExtension,
  validateExtensionShallow,
} from "./validation.ts";
import type { Extension, ExtensionContext, ExtensionLogger, ResolvedExtension } from "./types.ts";
import { hasControlCharacters, identifierIssue, MAX_CONTRACT_NAME_LENGTH } from "./identifiers.ts";

const DEFAULT_SETUP_TIMEOUT_MS = 30_000;
const DEFAULT_TEARDOWN_TIMEOUT_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SETUP_TIMEOUT_SENTINEL = Symbol("extension-setup-timeout");
const VALID_EXTENSION_SOURCES = new Set(["config", "package", "project", "local-file", "builtin"]);
const MAX_PRIMED_CONTRACTS = 128;
const MAX_PRESET_DEPTH = 64;
const MAX_FLATTENED_EXTENSIONS = 4_096;
const MAX_RESOLVED_EXTENSIONS = 4_096;
let contractRegistryLifecycleTail: Promise<void> = Promise.resolve();

function isNonArrayObject(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function enqueueContractRegistryLifecycle(operation: () => Promise<void>): Promise<void> {
  const result = contractRegistryLifecycleTail.then(operation, operation);
  contractRegistryLifecycleTail = result.catch(() => {});
  return result;
}

/** Options for {@link ExtensionLoader.setupAll}. */
export interface SetupAllOptions {
  /**
   * Per-extension setup() timeout in milliseconds.
   * Defaults to 30 000 ms. Pass `0` to disable.
   */
  setupTimeoutMs?: number;
  /** Per-extension teardown timeout used while replacing or rolling back a lifecycle. */
  teardownTimeoutMs?: number;
}

/** Options for {@link ExtensionLoader.teardownAll}. */
export interface TeardownAllOptions {
  /** Per-extension teardown timeout in milliseconds. Defaults to 30 000 ms. Pass `0` to disable. */
  teardownTimeoutMs?: number;
}

/** Implement extension loader. */
export class ExtensionLoader {
  private logger: ExtensionLogger;
  private setupOrder: ResolvedExtension[] = [];
  private setupContexts = new Map<ResolvedExtension, { revoke: () => void }>();
  private primed: Record<string, unknown> = Object.create(null);
  private contractBaseline: Map<string, unknown> | undefined;
  private lifecycleTail: Promise<void> = Promise.resolve();

  /**
   * Register contracts that will be re-applied after each `setupAll()`
   * teardown pass. Used by `orchestrateExtensions()` to seed infrastructure
   * (e.g. `LLMProviderRegistry`) before per-extension `setup()` runs.
   */
  primeContracts(contracts: Record<string, unknown>): void {
    if (!isNonArrayObject(contracts)) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Primed contracts must be an object",
      });
    }
    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(contracts);
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Primed contract fields could not be read safely",
      });
    }
    if (entries.length > MAX_PRIMED_CONTRACTS) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Primed contracts must contain at most ${MAX_PRIMED_CONTRACTS} entries`,
      });
    }

    const next: Record<string, unknown> = Object.assign(Object.create(null), this.primed);
    for (const [name, implementation] of entries) {
      const issue = identifierIssue(name, MAX_CONTRACT_NAME_LENGTH);
      if (issue) {
        throw EXTENSION_VALIDATION_ERROR.create({ message: `Contract name ${issue}` });
      }
      if (implementation === undefined) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: "Contract implementation cannot be undefined",
        });
      }
      Object.defineProperty(next, name, {
        configurable: true,
        enumerable: true,
        value: implementation,
        writable: true,
      });
    }
    this.primed = next;
  }

  /** Create a loader that reports lifecycle events through `logger`. */
  constructor(logger: ExtensionLogger) {
    this.logger = logger;
  }

  /**
   * Flatten presets: extensions with `extends` are replaced by their children.
   * Recurses through nested presets; throws on cyclic `extends` graphs rather
   * than stack-overflowing.
   */
  flattenPresets(extensions: ResolvedExtension[]): ResolvedExtension[] {
    assertResolvedExtensions(extensions);
    const result: ResolvedExtension[] = [];
    const pending = extensions.map((resolved) => ({
      depth: 0,
      path: new Set<Extension>(),
      resolved,
    })).reverse();

    while (pending.length > 0) {
      const frame = pending.pop()!;
      const { depth, path, resolved } = frame;
      const ext = resolved.extension;
      assertValidExtensionShallow(ext);
      if (ext.extends && ext.extends.length > 0) {
        if (path.has(ext)) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: `Circular preset extends chain detected via "${ext.name}"`,
          });
        }
        if (depth >= MAX_PRESET_DEPTH) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: `Preset depth must not exceed ${MAX_PRESET_DEPTH}`,
          });
        }
        const childPath = new Set(path);
        childPath.add(ext);
        for (let index = ext.extends.length - 1; index >= 0; index--) {
          pending.push({
            depth: depth + 1,
            path: childPath,
            resolved: {
              extension: ext.extends[index]!,
              source: resolved.source,
              origin: resolved.origin,
            },
          });
        }
      } else {
        if (result.length >= MAX_FLATTENED_EXTENSIONS) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message:
              `Preset flattening must produce at most ${MAX_FLATTENED_EXTENSIONS} extensions`,
          });
        }
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
    assertResolvedExtensions(extensions);
    const extByName = new Map<string, ResolvedExtension>();
    const consumesContracts = new Map<string, string[]>();

    for (const resolved of extensions) {
      const ext = resolved.extension;
      assertValidExtension(ext);
      const existing = extByName.get(ext.name);
      if (existing) {
        if (existing.extension === ext) continue;
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Duplicate extension name "${ext.name}"`,
        });
      }
      extByName.set(ext.name, resolved);
    }

    const uniqueExtensions = [...extByName.values()];
    const providerOf = new Map<string, string>();
    for (const [contract, provider] of selectContractProviders(uniqueExtensions)) {
      providerOf.set(contract, provider.extension.name);
    }

    for (const resolved of uniqueExtensions) {
      const ext = resolved.extension;
      const contracts = requiredContractNames(ext);
      if (contracts.length > 0) {
        consumesContracts.set(ext.name, contracts);
      }
    }

    // Build adjacency list
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const resolved of uniqueExtensions) {
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
    const sortedNames = new Set<string>();
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const name = queue[queueIndex++]!;
      sorted.push(extByName.get(name)!);
      sortedNames.add(name);

      for (const dependent of graph.get(name) || []) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== extByName.size) {
      const unsorted = [...extByName.values()]
        .filter((resolved) => !sortedNames.has(resolved.extension.name))
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
    const optionSnapshot = readSetupAllOptions(options);
    const timeoutMs = normalizeSetupTimeout(optionSnapshot.setupTimeoutMs);
    const teardownTimeoutMs = normalizeTeardownTimeout(optionSnapshot.teardownTimeoutMs);
    const extensionSnapshot = snapshotResolvedExtensions(extensions);
    assertResolvedExtensions(extensionSnapshot);
    const projectConfigSnapshot = snapshotProjectConfig(projectConfig);
    const primedContracts = this.primed;
    await this.enqueueLifecycle(() =>
      enqueueContractRegistryLifecycle(() =>
        this.setupAllLocked(
          extensionSnapshot,
          projectConfigSnapshot,
          primedContracts,
          timeoutMs,
          teardownTimeoutMs,
        )
      )
    );
  }

  /** Run one setup lifecycle while the instance lifecycle queue is held. */
  private async setupAllLocked(
    extensions: ResolvedExtension[],
    projectConfig: Readonly<Record<string, unknown>>,
    primedContracts: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    teardownTimeoutMs: number,
  ): Promise<void> {
    const loadOrder = this.topologicalSort(this.flattenPresets(extensions));

    const conflicts = detectConflicts(loadOrder);
    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => `"${c.contract}" provided by: ${c.providers.map((p) => p.name).join(", ")}`)
        .join("; ");
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Extension conflicts detected: ${details}`,
      });
    }

    const contractWinner = selectContractProviders(loadOrder);
    const previousOwner = getContractRegistryLifecycleOwner();
    if (previousOwner !== undefined && previousOwner !== this) {
      if (!(previousOwner instanceof ExtensionLoader)) {
        throw EXTENSION_CONFLICT_ERROR.create({
          message: "The extension contract registry has an invalid lifecycle owner",
        });
      }
      await previousOwner.performTeardown(teardownTimeoutMs);
    }
    if (!claimContractRegistryLifecycle(this)) {
      throw EXTENSION_CONFLICT_ERROR.create({
        message: "Another extension loader lifecycle is already active",
      });
    }
    try {
      await this.performTeardown(teardownTimeoutMs, false);
      this.contractBaseline = snapshotContracts();
      const safeLogger = this.createSafeLogger();

      for (const [name, impl] of Object.entries(primedContracts)) {
        register(name, impl);
      }

      for (const resolved of loadOrder) {
        const ext = resolved.extension;
        auditCapabilities(ext.name, ext.capabilities, safeLogger);

        if (ext.provides) {
          for (const [contract, impl] of Object.entries(ext.provides)) {
            if (contractWinner.get(contract) === resolved) {
              register(contract, impl);
            }
          }
        }

        if (ext.setup) {
          let ctxRevoked = false;
          const controller = new AbortController();
          const revoke = () => {
            ctxRevoked = true;
            if (!controller.signal.aborted) controller.abort();
          };
          const ctx: ExtensionContext = {
            get: <T>(contract: string) => ctxRevoked ? undefined : tryResolve<T>(contract),
            require: <T>(contract: string) => {
              if (ctxRevoked) {
                throw EXTENSION_VALIDATION_ERROR.create({
                  message: "Extension context is no longer active",
                });
              }
              return resolveContract<T>(contract);
            },
            provide: <T>(contract: string, impl: T) => {
              if (ctxRevoked) {
                this.log("warn", `Ignoring a late contract provide from extension "${ext.name}"`);
                return;
              }
              const winner = contractWinner.get(contract);
              if (!winner || winner === resolved) register(contract, impl);
            },
            config: projectConfig,
            logger: safeLogger,
            signal: controller.signal,
          };

          let setupFailure: { error: unknown } | undefined;
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
          } catch (error) {
            setupFailure = { error };
          }

          if (setupFailure) {
            revoke();
            const normalized = setupFailure.error === SETUP_TIMEOUT_SENTINEL
              ? EXTENSION_SETUP_TIMEOUT_ERROR.create({
                message: `Extension "${ext.name}" setup() timed out after ${timeoutMs}ms`,
                detail: `Extension setup did not complete within ${timeoutMs}ms`,
              })
              : setupFailure.error;
            if (ext.teardown) {
              try {
                await this.teardownExtension(ext, teardownTimeoutMs, "rollback");
              } catch {
                // teardownExtension already records a sanitized failure.
              }
            }
            throw normalized;
          }
          this.setupContexts.set(resolved, { revoke });
        }

        this.setupOrder.push(resolved);
        this.log(
          "info",
          `Extension "${ext.name}" v${ext.version} loaded from ${resolved.source}`,
        );
      }
    } catch (error) {
      await this.performTeardown(teardownTimeoutMs, false, "rollback");
      releaseContractRegistryLifecycle(this);
      throw error;
    }
  }

  /** Emit a lifecycle message without allowing logger failures to escape. */
  private log(level: keyof ExtensionLogger, message: string, ...args: unknown[]): void {
    try {
      this.logger[level](message, ...args);
    } catch {
      // Logging must not alter extension lifecycle behavior.
    }
  }

  /** Wrap the configured logger for use by untrusted extension code. */
  private createSafeLogger(): ExtensionLogger {
    return {
      debug: (message, ...args) => this.log("debug", message, ...args),
      info: (message, ...args) => this.log("info", message, ...args),
      warn: (message, ...args) => this.log("warn", message, ...args),
      error: (message, ...args) => this.log("error", message, ...args),
    };
  }

  /**
   * Teardown all loaded extensions in reverse order.
   */
  async teardownAll(options?: TeardownAllOptions): Promise<void> {
    const timeoutMs = normalizeTeardownTimeout(readTeardownAllOptions(options));
    await this.enqueueLifecycle(() =>
      enqueueContractRegistryLifecycle(() => this.performTeardown(timeoutMs))
    );
  }

  /** Tear down the active lifecycle and restore its baseline contracts. */
  private async performTeardown(
    timeoutMs: number,
    releaseLifecycleOwnership = true,
    phase: "rollback" | "shutdown" = "shutdown",
  ): Promise<void> {
    const reversed = [...this.setupOrder].reverse();
    this.setupOrder = [];
    for (const resolved of reversed) {
      this.setupContexts.get(resolved)?.revoke();
    }
    this.setupContexts.clear();
    for (const resolved of reversed) {
      await this.teardownExtension(resolved.extension, timeoutMs, phase);
    }
    if (this.contractBaseline) {
      restoreContracts(this.contractBaseline);
      this.contractBaseline = undefined;
    }
    if (releaseLifecycleOwnership) releaseContractRegistryLifecycle(this);
  }

  /** Tear down one extension within the configured time budget. */
  private async teardownExtension(
    extension: Extension,
    timeoutMs: number,
    phase: "rollback" | "shutdown",
  ): Promise<void> {
    if (!extension.teardown) return;

    const controller = new AbortController();
    const context = Object.freeze({ signal: controller.signal, phase });
    const operation = Promise.resolve()
      .then(() => extension.teardown!(context))
      .then(
        () => ({ kind: "success" }) as const,
        () => ({ kind: "failure" }) as const,
      );
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const outcome = timeoutMs === 0 ? await operation : await Promise.race([
      operation,
      new Promise<{ readonly kind: "timeout" }>((resolve) => {
        timerId = setTimeout(
          () => {
            controller.abort();
            resolve({ kind: "timeout" });
          },
          timeoutMs,
        );
      }),
    ]).finally(() => {
      clearTimeout(timerId);
      if (!controller.signal.aborted) controller.abort();
    });

    if (outcome.kind === "failure") {
      this.log("error", `${phase === "rollback" ? "Rollback teardown" : "Teardown"} failed`);
    } else if (outcome.kind === "timeout") {
      this.log(
        "error",
        `${phase === "rollback" ? "Rollback teardown" : "Teardown"} timed out after ${timeoutMs}ms`,
      );
    }
  }

  /** Serialize lifecycle mutations for this loader instance. */
  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.catch(() => {});
    return result;
  }
}

function normalizeSetupTimeout(value: unknown): number {
  return normalizeLifecycleTimeout("setupTimeoutMs", value, DEFAULT_SETUP_TIMEOUT_MS);
}

function normalizeTeardownTimeout(value: unknown): number {
  return normalizeLifecycleTimeout("teardownTimeoutMs", value, DEFAULT_TEARDOWN_TIMEOUT_MS);
}

function normalizeLifecycleTimeout(
  field: string,
  value: unknown,
  defaultValue: number,
): number {
  const timeout = value === undefined ? defaultValue : value;
  if (
    typeof timeout !== "number" || !Number.isSafeInteger(timeout) ||
    timeout < 0 || timeout > MAX_TIMER_DELAY_MS
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `${field} must be a non-negative safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
    });
  }
  return timeout;
}

function readSetupAllOptions(options: unknown): {
  setupTimeoutMs: unknown;
  teardownTimeoutMs: unknown;
} {
  if (options === undefined) {
    return { setupTimeoutMs: undefined, teardownTimeoutMs: undefined };
  }
  if (!isNonArrayObject(options)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension lifecycle options must be an object",
    });
  }
  try {
    return {
      setupTimeoutMs: Reflect.get(options, "setupTimeoutMs"),
      teardownTimeoutMs: Reflect.get(options, "teardownTimeoutMs"),
    };
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension lifecycle options could not be read safely",
    });
  }
}

function readTeardownAllOptions(options: unknown): unknown {
  if (options === undefined) return undefined;
  if (!isNonArrayObject(options)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension lifecycle options must be an object",
    });
  }
  try {
    return Reflect.get(options, "teardownTimeoutMs");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Extension lifecycle options could not be read safely",
    });
  }
}

function assertValidExtension(extension: unknown): asserts extension is Extension {
  const issues = validateExtension(extension);
  if (issues.length > 0) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension is invalid:\n  ${issues.join("\n  ")}`,
    });
  }
}

function assertValidExtensionShallow(extension: unknown): asserts extension is Extension {
  const issues = validateExtensionShallow(extension);
  if (issues.length > 0) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension is invalid:\n  ${issues.join("\n  ")}`,
    });
  }
}

function assertResolvedExtensions(extensions: unknown): asserts extensions is ResolvedExtension[] {
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(extensions);
    length = isArray ? Reflect.get(extensions as object, "length") : undefined;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Extensions must be an array" });
  }
  if (!isArray || typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Extensions must be an array" });
  }
  if (length > MAX_RESOLVED_EXTENSIONS) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extensions must contain at most ${MAX_RESOLVED_EXTENSIONS} entries`,
    });
  }
  for (let index = 0; index < length; index++) {
    let resolved: unknown;
    let extension: unknown;
    let origin: unknown;
    let source: unknown;
    try {
      resolved = Reflect.get(extensions as object, index);
      if (resolved === null || typeof resolved !== "object" || Array.isArray(resolved)) {
        throw new TypeError();
      }
      extension = Reflect.get(resolved, "extension");
      origin = Reflect.get(resolved, "origin");
      source = Reflect.get(resolved, "source");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Resolved extension must be an object with readable fields",
      });
    }
    if (typeof source !== "string" || !VALID_EXTENSION_SOURCES.has(source)) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension source is invalid" });
    }
    if (
      typeof origin !== "string" || origin.length === 0 ||
      origin.length > 4_096 || hasControlCharacters(origin)
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({ message: "Resolved extension origin is invalid" });
    }
    assertValidExtensionShallow(extension);
  }
}

function requiredContractNames(ext: Extension): string[] {
  return ext.contracts?.requires ?? [];
}
