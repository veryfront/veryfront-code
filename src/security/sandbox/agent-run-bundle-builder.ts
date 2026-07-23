import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { bundleHandlerModuleForIsolation } from "#veryfront/routing/api/module-loader/loader.ts";
import { parseSourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import * as path from "#veryfront/compat/path";
import {
  AGENT_RUN_WORKER_MAX_MODULE_BYTES,
  AGENT_RUN_WORKER_MAX_MODULES,
  AGENT_RUN_WORKER_MAX_TOTAL_MODULE_BYTES,
  AGENT_RUN_WORKER_PROTOCOL_VERSION,
  type AgentRunDiscoveryConcept,
  type AgentRunExecutionBundle,
  type AgentRunExecutionModule,
  type AgentRunIdentity,
  type AgentRunWorkerPreparationRequest,
  type AgentRunWorkerPreparationResponse,
  assertPlainAgentRunProtocolData,
  assertValidAgentRunExecutionBundle,
  assertValidAgentRunWorkerPreparationRequest,
  assertValidAgentRunWorkerPreparationResponse,
  verifyAgentRunExecutionBundleSource,
} from "./agent-run-worker-contract.ts";
import type { InternalAgentStreamRequest } from "#veryfront/internal-agents/schema.ts";
import {
  collectProjectSourceSnapshot,
  createProjectSnapshotFileSystem,
  type ProjectSourceSnapshot,
  verifyProjectSourceSnapshot,
} from "./project-source-snapshot.ts";
import { prepareProjectConfigModule } from "./project-config-module.ts";
import { prepareAgentRunConfigInDisposableWorker } from "./project-config-worker-client.ts";

const encoder = new TextEncoder();
const SNAPSHOT_PROJECT_ROOT = "/__veryfront_agent_source__";
const DISCOVERY_MODULE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs)$/i;
const TYPESCRIPT_DECLARATION_PATTERN = /\.d\.(?:ts|tsx)$/i;

export interface AgentRunModuleBundlerInput {
  sourcePath: string;
  projectRoot: string;
  modulePath: string;
  adapter: RuntimeAdapter;
  sourceSnapshot: ProjectSourceSnapshot;
}

export interface BuildAgentRunExecutionBundleInput {
  projectDir: string;
  adapter: RuntimeAdapter;
  run: AgentRunIdentity;
  request: InternalAgentStreamRequest;
  projectEnv?: Record<string, string>;
  framework: AgentRunExecutionBundle["framework"];
  /** Resolve config inside a disposable config-only Worker. */
  prepareInWorker?(
    request: AgentRunWorkerPreparationRequest,
  ): Promise<AgentRunWorkerPreparationResponse>;
  /** Test seam and alternate compiler that must not evaluate the project module. */
  bundleModule?(input: AgentRunModuleBundlerInput): Promise<string>;
  /** Override only for adapters whose virtual-root identity is not introspectable. */
  virtualRoot?: boolean;
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function cloneStructured<T>(value: T, label: string): T {
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError(`${label} is not structured-cloneable`);
  }
}

function isWithinRoot(sourcePath: string, root: string): boolean {
  return sourcePath === root || sourcePath.startsWith(`${root}/`);
}

function isColocatedAgentTool(sourcePath: string, agentRoot: string): boolean {
  if (!sourcePath.startsWith(`${agentRoot}/`)) return false;
  const relativeSegments = sourcePath.slice(agentRoot.length + 1).split("/");
  return relativeSegments.length >= 3 && relativeSegments[1] === "tools";
}

function collectModuleCandidates(
  snapshot: ProjectSourceSnapshot,
  roots: Pick<AgentRunExecutionBundle["discovery"], "agentDirs" | "toolDirs">,
): Array<{ sourcePath: string; concepts: AgentRunDiscoveryConcept[] }> {
  const candidates: Array<{ sourcePath: string; concepts: AgentRunDiscoveryConcept[] }> = [];
  for (const file of snapshot.files) {
    if (
      !DISCOVERY_MODULE_PATTERN.test(file.sourcePath) ||
      TYPESCRIPT_DECLARATION_PATTERN.test(file.sourcePath)
    ) continue;

    const concepts = new Set<AgentRunDiscoveryConcept>();
    for (const root of roots.agentDirs) {
      if (!isWithinRoot(file.sourcePath, root)) continue;
      concepts.add("agent");
      if (isColocatedAgentTool(file.sourcePath, root)) concepts.add("tool");
    }
    for (const root of roots.toolDirs) {
      if (isWithinRoot(file.sourcePath, root)) concepts.add("tool");
    }
    if (concepts.size === 0) continue;
    candidates.push({
      sourcePath: file.sourcePath,
      concepts: [...concepts].sort(),
    });
  }
  candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  if (candidates.length > AGENT_RUN_WORKER_MAX_MODULES) {
    throw new RangeError("Agent run module count exceeds the supported limit");
  }
  return candidates;
}

function createSnapshotRuntimeAdapter(
  adapter: RuntimeAdapter,
  snapshot: ProjectSourceSnapshot,
): RuntimeAdapter {
  const snapshotFs = createProjectSnapshotFileSystem(snapshot, SNAPSHOT_PROJECT_ROOT);
  return new Proxy(adapter, {
    get(target, property, receiver) {
      return property === "fs" ? snapshotFs : Reflect.get(target, property, receiver);
    },
  });
}

async function defaultBundleModule(input: AgentRunModuleBundlerInput): Promise<string> {
  return await bundleHandlerModuleForIsolation({
    projectDir: input.projectRoot,
    modulePath: input.modulePath,
    adapter: input.adapter,
  });
}

async function compileDiscoveryModules(input: {
  snapshot: ProjectSourceSnapshot;
  runtimeAdapter: RuntimeAdapter;
  agentDirs: string[];
  toolDirs: string[];
  bundleModule: (input: AgentRunModuleBundlerInput) => Promise<string>;
  signal?: AbortSignal;
}): Promise<AgentRunExecutionModule[]> {
  const candidates = collectModuleCandidates(input.snapshot, input);
  const modules: AgentRunExecutionModule[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    throwIfAborted(input.signal);
    const modulePath = path.join(SNAPSHOT_PROJECT_ROOT, candidate.sourcePath);
    const moduleCode = await input.bundleModule({
      ...candidate,
      projectRoot: SNAPSHOT_PROJECT_ROOT,
      modulePath,
      adapter: input.runtimeAdapter,
      sourceSnapshot: input.snapshot,
    });
    if (typeof moduleCode !== "string" || moduleCode.length === 0) {
      throw new TypeError("Agent run module compiler returned invalid code");
    }
    const bytes = encoder.encode(moduleCode).byteLength;
    if (bytes > AGENT_RUN_WORKER_MAX_MODULE_BYTES) {
      throw new RangeError("Agent run module exceeds the supported byte limit");
    }
    totalBytes += bytes;
    if (totalBytes > AGENT_RUN_WORKER_MAX_TOTAL_MODULE_BYTES) {
      throw new RangeError("Agent run modules exceed the supported total byte limit");
    }
    modules.push({ ...candidate, moduleCode });
  }
  return modules;
}

/**
 * Snapshot one exact project source, evaluate config only in a disposable
 * config Worker, and compile only the discovery roots returned by that Worker.
 */
export async function buildAgentRunExecutionBundle(
  input: BuildAgentRunExecutionBundleInput,
): Promise<AgentRunExecutionBundle> {
  throwIfAborted(input.signal);
  assertPlainAgentRunProtocolData(input.run, "Agent run identity");
  assertPlainAgentRunProtocolData(input.request, "Agent run request");
  assertPlainAgentRunProtocolData(input.framework, "Agent run framework context");
  if (input.projectEnv !== undefined) {
    assertPlainAgentRunProtocolData(input.projectEnv, "Agent run project environment");
  }
  const run = cloneStructured(input.run, "Agent run identity");
  const request = cloneStructured(input.request, "Agent run request");
  const framework = cloneStructured(input.framework, "Agent run framework context");
  const projectEnv = input.projectEnv === undefined
    ? undefined
    : cloneStructured(input.projectEnv, "Agent run project environment");

  const sourceSnapshot = await collectProjectSourceSnapshot({
    projectDir: input.projectDir,
    fs: input.adapter.fs,
    virtualRoot: input.virtualRoot ?? isVirtualFilesystem(input.adapter.fs),
  });
  await verifyProjectSourceSnapshot(sourceSnapshot);
  throwIfAborted(input.signal);
  const configModule = await prepareProjectConfigModule(sourceSnapshot);
  const preparation: AgentRunWorkerPreparationRequest = {
    type: "prepare-agent-run",
    schemaVersion: AGENT_RUN_WORKER_PROTOCOL_VERSION,
    preparationId: crypto.randomUUID(),
    sourceDigest: sourceSnapshot.digest,
    ...(configModule === undefined ? {} : { configModule }),
  };
  assertValidAgentRunWorkerPreparationRequest(preparation);

  const prepared = await (input.prepareInWorker ?? prepareAgentRunConfigInDisposableWorker)(
    preparation,
  );
  assertValidAgentRunWorkerPreparationResponse(prepared, preparation);
  throwIfAborted(input.signal);
  const projection = cloneStructured(prepared.projection, "Agent project config projection");
  const agentDirs = [...projection.agentDirs];
  const toolDirs = [...projection.toolDirs];
  const skillDirs = [...projection.skillDirs];
  const modules = await compileDiscoveryModules({
    snapshot: sourceSnapshot,
    runtimeAdapter: createSnapshotRuntimeAdapter(input.adapter, sourceSnapshot),
    agentDirs,
    toolDirs,
    bundleModule: input.bundleModule ?? defaultBundleModule,
    signal: input.signal,
  });

  const bundle: AgentRunExecutionBundle = {
    schemaVersion: AGENT_RUN_WORKER_PROTOCOL_VERSION,
    preparationId: preparation.preparationId,
    run,
    request,
    sourceSnapshot,
    discovery: { agentDirs, toolDirs, skillDirs, modules },
    sourceIntegrationPolicy: parseSourceIntegrationPolicyManifest(
      projection.sourceIntegrationPolicy,
    ),
    ...(projectEnv === undefined ? {} : { projectEnv }),
    framework,
  };
  assertValidAgentRunExecutionBundle(bundle);
  await verifyAgentRunExecutionBundleSource(bundle);
  return bundle;
}
