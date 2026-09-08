import { isAbsolute, join, relative, sep } from "node:path";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type {
  ProjectAgentRuntimeAgentSource,
  ProjectAgentRuntimeDiscovery,
} from "#veryfront/agent/project/agent-runtime.ts";
import type { RuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-definition.ts";
import type { ExecutorOperation, ExecutorOperationContext } from "../executor/channel.ts";
import { type ExecutorBinding, getExecutorBindingSchema } from "../executor/protocol.ts";
import {
  discoveryFailureCode,
  discoverySuccess,
  EXECUTOR_DISCOVERY_MAX_AGENTS,
  ExecutorDiscoveryError,
  type ExecutorDiscoverySource,
  getExecutorAgentDefinitionSchema,
  getExecutorAgentDescribeRequestSchema,
  getExecutorAgentDescriptionSchema,
  getExecutorDiscoveryAgentSourceSchema,
  getExecutorDiscoveryCandidatesSchema,
  getExecutorDiscoveryDescriptionSchema,
  getExecutorDiscoveryIdSchema,
  getExecutorDiscoveryRequestSchema,
  getExecutorDiscoverySourceSchema,
  parseDiscoveryData,
} from "./executor-discovery-schema.ts";

export interface ExecutorDiscoveryBackend {
  load(signal: AbortSignal): Promise<ProjectAgentRuntimeDiscovery>;
  /** Own partial setup even when load throws before returning a runtime. */
  cleanup(runtime: ProjectAgentRuntimeDiscovery | undefined): Promise<void>;
}

export interface ExecutorDiscoveryOptions {
  binding: ExecutorBinding;
  source: ExecutorDiscoverySource;
  projectDir: string;
  agentSource?: ProjectAgentRuntimeAgentSource;
  defaultAgentId?: string;
  signal: AbortSignal;
  /** Local dependency injection; never populated from the protocol. */
  backend?: ExecutorDiscoveryBackend;
}

export interface ExecutorDiscovery {
  readonly operations: ReadonlyMap<string, ExecutorOperation>;
  readonly signal: AbortSignal;
  /** Local-only access for the next runtime.prepare stage. */
  getRuntime(): ProjectAgentRuntimeDiscovery;
  /**
   * Retain original runtime work before cleanup starts, including work spawned
   * by retained startup after cancellation. Tasks must not await discovery
   * operations, close(), or settled; those can themselves await cleanup.
   */
  retainRuntimeTask(task: Promise<unknown>): void;
  /** Resolves after discovery, retained runtime work, and partial-resource cleanup settle. */
  readonly settled: Promise<void>;
  close(): Promise<void>;
}

/**
 * One allocation's executor-local metadata owner. Construction does not load
 * project configuration. Cleanup is not a process-reuse guarantee: the owning
 * session must destroy the executor after this allocation.
 */
export function createExecutorDiscovery(input: ExecutorDiscoveryOptions): ExecutorDiscovery {
  const binding = Object.freeze(parseDiscoveryData(getExecutorBindingSchema(), input.binding));
  const source = Object.freeze(
    parseDiscoveryData(getExecutorDiscoverySourceSchema(), input.source),
  );
  const agentSource = parseDiscoveryData(
    getExecutorDiscoveryAgentSourceSchema(),
    input.agentSource ?? "auto",
  );
  const defaultId = input.defaultAgentId === undefined
    ? undefined
    : parseDiscoveryData(getExecutorDiscoveryIdSchema(), input.defaultAgentId);
  if (
    typeof input.projectDir !== "string" || !isAbsolute(input.projectDir) ||
    !(input.signal instanceof AbortSignal)
  ) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_INVALID_INPUT");
  const projectDir = input.projectDir;
  const lifetime = new AbortController();
  const settled = Promise.withResolvers<void>();
  void settled.promise.catch(() => {});
  let tail: Promise<void> = Promise.resolve();
  let backend = input.backend;
  let loadStarted = false;
  let discovered = false;
  let setupFailed = false;
  let runtime: ProjectAgentRuntimeDiscovery | undefined;
  let closing: Promise<void> | undefined;
  let cleanupStarted = false;
  const runtimeTasks = new Set<Promise<void>>();
  const definitions = new Map<string, RuntimeAgentMarkdownDefinition>();
  const helpers = () => import("#veryfront/agent/project/agent-runtime.ts");

  function assertActive() {
    if (lifetime.signal.aborted) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_CLOSED");
  }
  function close(): Promise<void> {
    if (closing) return closing;
    // Memoize before synchronous abort listeners can reenter close().
    closing = tail.then(async () => {
      try {
        // Re-read after each batch: retained startup may reserve producer work
        // after cancellation, before its own promise settles.
        while (runtimeTasks.size > 0) await Promise.all(runtimeTasks);
        cleanupStarted = true;
        if (loadStarted) await backend?.cleanup(runtime);
      } catch {
        throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_CLEANUP_FAILED");
      } finally {
        runtime = undefined;
        definitions.clear();
      }
    });
    void closing.then(settled.resolve, settled.reject);
    input.signal.removeEventListener("abort", onAbort);
    lifetime.abort();
    return closing;
  }
  const onAbort = () => {
    void close().catch(() => {});
  };
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) onAbort();

  async function discover() {
    assertActive();
    if (runtime && discovered) return runtime;
    if (!backend) {
      const { createNodeExecutorDiscoveryBackend } = await import("./executor-discovery-node.ts");
      assertActive();
      backend = createNodeExecutorDiscoveryBackend({
        projectDir,
        cacheKey: JSON.stringify(binding),
      });
    }
    loadStarted = true;
    try {
      runtime = await backend.load(lifetime.signal);
      assertActive();
      // Validate the whole catalog before publishing local or wire access.
      const module = await helpers();
      parseDiscoveryData(
        getExecutorDiscoveryCandidatesSchema(),
        module.getProjectAgentRuntimeAgentIdCandidates(runtime),
        true,
      );
      discovered = true;
    } catch (error) {
      setupFailed = true;
      throw error;
    }
    return runtime;
  }

  async function describeAgent(discovery: ProjectAgentRuntimeDiscovery, agentId: string) {
    const cached = definitions.get(agentId);
    if (cached) return cached;
    if (definitions.size >= EXECUTOR_DISCOVERY_MAX_AGENTS) {
      throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_BUSY");
    }
    const module = await helpers();
    const found = discovery.agents.get(agentId);
    let definition: RuntimeAgentMarkdownDefinition;
    if (found && module.doesProjectAgentRuntimeAgentMatchSource(found, agentSource)) {
      const projected = await module.runWithProjectAgentRuntime(
        discovery,
        () => module.createRuntimeAgentDefinitionFromAgent(found),
      );
      definition = { ...projected, id: agentId };
    } else {
      if (agentSource === "code") throw new ExecutorDiscoveryError("AGENT_NOT_FOUND");
      const files = await import("#veryfront/agent/runtime/agent-definition-files.ts");
      const lookup = { baseDir: projectDir, id: agentId };
      if (!files.resolveRuntimeAgentDefinitionsDirInputSchema.safeParse(lookup).success) {
        throw new ExecutorDiscoveryError("AGENT_NOT_FOUND");
      }
      try {
        // The standalone service helper searches ancestors for source-layout
        // compatibility. An executor must attribute only its bound source.
        const { realpath, readFile } = await import("node:fs/promises");
        const root = await realpath(projectDir);
        const file = await realpath(join(root, "agents", `${agentId}.md`));
        const localPath = relative(root, file);
        if (localPath === ".." || localPath.startsWith(`..${sep}`) || isAbsolute(localPath)) {
          throw new ExecutorDiscoveryError("AGENT_NOT_FOUND");
        }
        const { parseRuntimeAgentMarkdownDefinition } = await import(
          "#veryfront/agent/runtime/agent-definition.ts"
        );
        definition = parseRuntimeAgentMarkdownDefinition({
          id: agentId,
          content: await readFile(file, "utf8"),
        });
      } catch (error) {
        if (
          error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ) throw new ExecutorDiscoveryError("AGENT_NOT_FOUND");
        throw error;
      }
    }
    assertActive();
    const parsed = parseDiscoveryData(getExecutorAgentDefinitionSchema(), definition, true);
    if (parsed.id !== agentId) {
      throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_INVALID_OUTPUT");
    }
    definitions.set(agentId, parsed);
    return parsed;
  }

  async function execute(
    context: ExecutorOperationContext,
    operation: () => Promise<JsonValue>,
  ): Promise<JsonValue> {
    if (
      context.binding.allocationId !== binding.allocationId ||
      context.binding.generation !== binding.generation ||
      context.binding.invocationId !== binding.invocationId
    ) return { ok: false, code: "EXECUTOR_DISCOVERY_BINDING_MISMATCH" };
    if (lifetime.signal.aborted) return { ok: false, code: "EXECUTOR_DISCOVERY_CLOSED" };
    const onCancel = () => {
      void close().catch(() => {});
    };
    context.signal.addEventListener("abort", onCancel, { once: true });
    const work = tail.then(async () => {
      if (context.signal.aborted || Date.now() >= context.deadline) {
        onCancel();
        throw new ExecutorDiscoveryError("ABORTED");
      }
      assertActive();
      const value = await operation();
      assertActive();
      if (context.signal.aborted || Date.now() >= context.deadline) {
        onCancel();
        throw new ExecutorDiscoveryError("ABORTED");
      }
      return value;
    });
    tail = work.then(() => {}, () => {});
    if (context.signal.aborted) onCancel();
    try {
      return await work;
    } catch (error) {
      const code = lifetime.signal.aborted ? "ABORTED" : discoveryFailureCode(error);
      if (
        setupFailed || code === "EXECUTOR_DISCOVERY_FAILED" ||
        code === "EXECUTOR_DISCOVERY_INVALID_OUTPUT" ||
        code === "ABORTED"
      ) {
        try {
          await close();
        } catch {
          return { ok: false, code: "EXECUTOR_DISCOVERY_CLEANUP_FAILED" };
        }
      }
      return { ok: false, code };
    } finally {
      context.signal.removeEventListener("abort", onCancel);
    }
  }

  const operations = new Map<string, ExecutorOperation>([
    ["discovery.describe", {
      mode: "unary",
      handle(value, context) {
        return execute(context, async () => {
          parseDiscoveryData(getExecutorDiscoveryRequestSchema(), value);
          const discovery = await discover();
          const module = await helpers();
          const candidates = module.getProjectAgentRuntimeAgentIdCandidates(discovery);
          const defaultAgentId = defaultId ??
            module.resolveSingleProjectAgentRuntimeAgentId({ candidates, source: agentSource });
          if (!defaultAgentId) throw new ExecutorDiscoveryError("CONFIG_INVALID");
          const definition = await describeAgent(discovery, defaultAgentId);
          return discoverySuccess(
            parseDiscoveryData(getExecutorDiscoveryDescriptionSchema(), {
              source,
              candidates,
              defaultAgentId,
              definition,
              errorCount: discovery.errors.length,
            }, true),
          );
        });
      },
    }],
    ["agent.describe", {
      mode: "unary",
      handle(value, context) {
        return execute(context, async () => {
          const request = parseDiscoveryData(getExecutorAgentDescribeRequestSchema(), value);
          const discovery = await discover();
          const definition = await describeAgent(discovery, request.agentId);
          return discoverySuccess(
            parseDiscoveryData(getExecutorAgentDescriptionSchema(), { source, definition }, true),
          );
        });
      },
    }],
  ]);
  return {
    operations,
    signal: lifetime.signal,
    settled: settled.promise,
    close,
    retainRuntimeTask(task) {
      if (cleanupStarted) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_CLOSED");
      const retained = task.then(() => {}, () => {});
      runtimeTasks.add(retained);
      void retained.then(() => runtimeTasks.delete(retained));
    },
    getRuntime() {
      assertActive();
      if (!runtime || !discovered) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_NOT_READY");
      return runtime;
    },
  };
}
