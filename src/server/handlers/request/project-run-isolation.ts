import type { AgentServiceEvalAdapterConfig } from "#veryfront/eval/agent-service.ts";
import { API_ERROR } from "#veryfront/errors";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import {
  discoveryFileUrlToPath,
  findTypeScriptFiles,
} from "#veryfront/discovery/file-discovery.ts";
import { detectPlatform } from "#veryfront/platform/core-platform.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { bundleHandlerModuleForIsolation } from "#veryfront/routing/api/module-loader/loader.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  assertValidProjectRunWorkerRequest,
  PROJECT_RUN_WORKER_VIRTUAL_ROOT,
  snapshotProjectRunWorkerResult,
} from "#veryfront/security/sandbox/project-run-worker-contract.ts";
import type {
  ExecuteProjectRunRequest,
  ProjectRunWorkerDatasetFile,
  ProjectRunWorkerEvalAgentAdapter,
  ProjectRunWorkerModule,
  SerializedProjectRunResult,
} from "#veryfront/security/sandbox/worker-types.ts";
import {
  MAX_PROJECT_RUN_WORKER_DATASET_BYTES,
  MAX_PROJECT_RUN_WORKER_DATASET_FILES,
  MAX_PROJECT_RUN_WORKER_MODULE_BYTES,
  MAX_PROJECT_RUN_WORKER_MODULES,
  MAX_PROJECT_RUN_WORKER_TOTAL_MODULE_BYTES,
} from "#veryfront/security/sandbox/worker-types.ts";
import type { HandlerContext } from "../types.ts";
import type { ProjectRunExecuteRequest } from "./project-run-types.ts";
import * as path from "#veryfront/compat/path";

const encoder = new TextEncoder();
const MAX_SOURCE_PATH_LENGTH = 4_096;
const MAX_SOURCE_SCAN_DEPTH = 64;
const MAX_SOURCE_SCAN_ENTRIES = 20_000;

function normalizeDiscoveryDirectory(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 || normalized.length > MAX_SOURCE_PATH_LENGTH ||
    path.isAbsolute(normalized) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    hasControlCharacter(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project discovery directory must be project-relative");
  }
  return normalized;
}

function createVirtualModuleLocation(
  modulePath: string,
  directory: string,
  projectDir: string,
  virtualRoot: boolean,
): { file: string; dir: string } {
  const relativePath = normalizeProjectRelativeSourcePath(
    modulePath,
    projectDir,
    virtualRoot,
  );
  const virtualFile = path.join(PROJECT_RUN_WORKER_VIRTUAL_ROOT, relativePath)
    .replaceAll("\\", "/");
  const virtualDir = path.join(PROJECT_RUN_WORKER_VIRTUAL_ROOT, directory)
    .replaceAll("\\", "/");
  return { file: `file://${virtualFile}`, dir: virtualDir };
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate).replaceAll("\\", "/");
  return relative === "" ||
    (relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative));
}

function virtualizeProjectBundlePaths(moduleCode: string, projectDir: string): string {
  const resolvedRoot = path.resolve(projectDir);
  const filesystemRoot = path.parse(resolvedRoot).root;
  if (resolvedRoot === filesystemRoot) return moduleCode;

  const packagePath = path.join(resolvedRoot, "package.json");
  const configuredPackagePath = `${projectDir}/package.json`;
  const virtualPackagePath = path.join(PROJECT_RUN_WORKER_VIRTUAL_ROOT, "package.json");
  let virtualized = moduleCode
    .replaceAll(JSON.stringify(configuredPackagePath), JSON.stringify(virtualPackagePath))
    .replaceAll(JSON.stringify(packagePath), JSON.stringify(virtualPackagePath))
    .replaceAll(JSON.stringify(resolvedRoot), JSON.stringify(PROJECT_RUN_WORKER_VIRTUAL_ROOT));

  virtualized = virtualized.split("\n").map((line) => {
    if (!line.startsWith("// ")) return line;
    const label = line.slice(3).trim();
    if (!label) return line;
    const adapterNamespace = label.startsWith("vf-adapter:") ? "vf-adapter:" : "";
    const labelPath = adapterNamespace ? label.slice(adapterNamespace.length) : label;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(labelPath) && !path.isAbsolute(labelPath)) return line;
    const resolvedLabel = path.resolve(labelPath);
    if (!isPathWithin(resolvedRoot, resolvedLabel)) return line;
    const relativeLabel = path.relative(resolvedRoot, resolvedLabel).replaceAll("\\", "/");
    const virtualLabel = path.join(PROJECT_RUN_WORKER_VIRTUAL_ROOT, relativeLabel)
      .replaceAll("\\", "/");
    return `// ${adapterNamespace}${virtualLabel}`;
  }).join("\n");

  return virtualized;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

export interface ExecuteIsolatedProjectRunInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  evalAgentAdapter?: AgentServiceEvalAdapterConfig;
}

type ProjectRunWorkerPool = Pick<ReturnType<typeof getWorkerPool>, "execute" | "evictWorker">;

export interface ProjectRunIsolationDependencies {
  getWorkerPool(): ProjectRunWorkerPool;
}

const defaultDependencies: ProjectRunIsolationDependencies = { getWorkerPool };

type SourceFileProvider = {
  getAllSourceFiles(): Promise<Array<{ path: string; content?: string }>>;
};

function getProjectEnvSnapshot(): Record<string, string> | undefined {
  const getter = (globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter as
    | (() => Record<string, string> | undefined)
    | undefined;
  return getter?.();
}

function getSourceFileProvider(fs: FileSystemAdapter): SourceFileProvider | null {
  const wrapped = fs as {
    getUnderlyingAdapter?: () => unknown;
    getAllSourceFiles?: SourceFileProvider["getAllSourceFiles"];
  };
  if (typeof wrapped.getAllSourceFiles === "function") {
    return { getAllSourceFiles: wrapped.getAllSourceFiles.bind(wrapped) };
  }
  if (typeof wrapped.getUnderlyingAdapter !== "function") return null;
  const underlying = wrapped.getUnderlyingAdapter() as Partial<SourceFileProvider>;
  return typeof underlying.getAllSourceFiles === "function"
    ? { getAllSourceFiles: underlying.getAllSourceFiles.bind(underlying) }
    : null;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeProjectRelativeSourcePath(
  value: unknown,
  projectDir: string,
  virtualRoot: boolean,
): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_SOURCE_PATH_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new TypeError("Project source returned an invalid path");
  }
  const withoutProtocol = value.startsWith("file://") ? value.slice("file://".length) : value;
  let candidate = withoutProtocol.replaceAll("\\", "/");
  if (path.isAbsolute(candidate)) {
    if (virtualRoot) {
      candidate = candidate.replace(/^\/+/, "");
    } else {
      const relative = path.relative(path.resolve(projectDir), path.resolve(candidate))
        .replaceAll("\\", "/");
      if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
        throw new TypeError("Project source path is outside the project root");
      }
      candidate = relative;
    }
  }
  candidate = candidate.replace(/^\.\//, "");
  const segments = candidate.split("/");
  if (
    candidate.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project source path must be project-relative");
  }
  return candidate;
}

function isDatasetSourcePath(value: string): boolean {
  return /\.(?:json|jsonl)$/i.test(value);
}

async function collectDatasetFileFromPath(
  fs: FileSystemAdapter,
  sourcePath: string,
  relativePath: string,
): Promise<ProjectRunWorkerDatasetFile> {
  const info = await fs.stat(sourcePath);
  if (!info.isFile || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw new TypeError("Project dataset source is invalid");
  }
  if (info.size > MAX_PROJECT_RUN_WORKER_DATASET_BYTES) {
    throw new RangeError("Project run dataset payload exceeds the size limit");
  }
  const content = await fs.readFile(sourcePath);
  if (encoder.encode(content).byteLength > MAX_PROJECT_RUN_WORKER_DATASET_BYTES) {
    throw new RangeError("Project run dataset payload exceeds the size limit");
  }
  return { path: relativePath, content };
}

async function collectDatasetFilesFromProvider(
  provider: SourceFileProvider,
  fs: FileSystemAdapter,
  projectDir: string,
  virtualRoot: boolean,
  signal: AbortSignal,
): Promise<ProjectRunWorkerDatasetFile[]> {
  const sources = await provider.getAllSourceFiles();
  throwIfAborted(signal);
  if (!Array.isArray(sources) || sources.length > MAX_SOURCE_SCAN_ENTRIES) {
    throw new RangeError("Project source file count exceeds the limit");
  }
  const files: ProjectRunWorkerDatasetFile[] = [];
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const source of sources) {
    throwIfAborted(signal);
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError("Project source file entry is invalid");
    }
    const relativePath = normalizeProjectRelativeSourcePath(
      source.path,
      projectDir,
      virtualRoot,
    );
    if (!isDatasetSourcePath(relativePath)) continue;
    if (seen.has(relativePath)) throw new TypeError("Project source contains duplicate paths");
    seen.add(relativePath);
    if (files.length >= MAX_PROJECT_RUN_WORKER_DATASET_FILES) {
      throw new RangeError("Project run dataset file count exceeds the limit");
    }
    const content = typeof source.content === "string"
      ? source.content
      : (await collectDatasetFileFromPath(fs, source.path, relativePath)).content;
    totalBytes += encoder.encode(content).byteLength;
    if (totalBytes > MAX_PROJECT_RUN_WORKER_DATASET_BYTES) {
      throw new RangeError("Project run dataset payload exceeds the size limit");
    }
    files.push({ path: relativePath, content });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectDatasetFilesByTraversal(
  fs: FileSystemAdapter,
  projectDir: string,
  virtualRoot: boolean,
  signal: AbortSignal,
): Promise<ProjectRunWorkerDatasetFile[]> {
  const files: ProjectRunWorkerDatasetFile[] = [];
  let entries = 0;
  let totalBytes = 0;
  const root = virtualRoot ? "/" : projectDir;

  async function visit(directory: string, depth: number): Promise<void> {
    throwIfAborted(signal);
    if (depth > MAX_SOURCE_SCAN_DEPTH) {
      throw new RangeError("Project source directory depth exceeds the limit");
    }
    for await (const entry of fs.readDir(directory)) {
      throwIfAborted(signal);
      entries++;
      if (entries > MAX_SOURCE_SCAN_ENTRIES) {
        throw new RangeError("Project source directory entry count exceeds the limit");
      }
      if (
        typeof entry.name !== "string" || entry.name.length === 0 ||
        entry.name.length > 255 || entry.name === "." || entry.name === ".." ||
        entry.name.includes("/") || entry.name.includes("\\") ||
        hasControlCharacter(entry.name)
      ) {
        throw new TypeError("Project source directory returned an invalid entry");
      }
      const sourcePath = directory === "/" ? `/${entry.name}` : path.join(directory, entry.name);
      if (entry.isDirectory && !entry.isSymlink) {
        await visit(sourcePath, depth + 1);
        continue;
      }
      if (!entry.isFile || entry.isSymlink) continue;
      const relativePath = normalizeProjectRelativeSourcePath(
        sourcePath,
        projectDir,
        virtualRoot,
      );
      if (!isDatasetSourcePath(relativePath)) continue;
      if (files.length >= MAX_PROJECT_RUN_WORKER_DATASET_FILES) {
        throw new RangeError("Project run dataset file count exceeds the limit");
      }
      const file = await collectDatasetFileFromPath(fs, sourcePath, relativePath);
      totalBytes += encoder.encode(file.content).byteLength;
      if (totalBytes > MAX_PROJECT_RUN_WORKER_DATASET_BYTES) {
        throw new RangeError("Project run dataset payload exceeds the size limit");
      }
      files.push(file);
    }
  }

  await visit(root, 0);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectProjectDatasetFiles(
  ctx: HandlerContext,
  virtualRoot: boolean,
  signal: AbortSignal,
): Promise<ProjectRunWorkerDatasetFile[]> {
  const provider = getSourceFileProvider(ctx.adapter.fs);
  return provider
    ? await collectDatasetFilesFromProvider(
      provider,
      ctx.adapter.fs,
      ctx.projectDir,
      virtualRoot,
      signal,
    )
    : await collectDatasetFilesByTraversal(
      ctx.adapter.fs,
      ctx.projectDir,
      virtualRoot,
      signal,
    );
}

function compareDiscoveryFiles(left: string, right: string): number {
  const isIndex = (value: string) =>
    /(?:^|\/)index\.(?:ts|tsx|js|jsx|mjs)$/.test(value.replace(/^file:\/\//, ""));
  const leftIndex = isIndex(left);
  const rightIndex = isIndex(right);
  return leftIndex === rightIndex ? left.localeCompare(right) : leftIndex ? 1 : -1;
}

async function collectProjectRunModules(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  signal: AbortSignal,
): Promise<{ modules: ProjectRunWorkerModule[]; virtualRoot: boolean }> {
  const config = createProjectDiscoveryConfig({
    projectDir: ctx.projectDir,
    config: ctx.config,
    fsAdapter: ctx.adapter.fs,
  });
  const directories = request.kind === "task" ? config.taskDirs : config.evalDirs;
  const context = {
    platform: detectPlatform(),
    fsAdapter: ctx.adapter.fs,
    baseDir: config.baseDir,
  };
  const modules: ProjectRunWorkerModule[] = [];
  let totalBytes = 0;

  for (const configuredDirectory of directories) {
    throwIfAborted(signal);
    const directory = normalizeDiscoveryDirectory(configuredDirectory);
    const root = config.baseDir ? path.join(config.baseDir, directory) : directory;
    const files = (await findTypeScriptFiles(root, context)).sort(compareDiscoveryFiles);
    for (const file of files) {
      throwIfAborted(signal);
      if (modules.length >= MAX_PROJECT_RUN_WORKER_MODULES) {
        throw new RangeError("Project run module count exceeds the limit");
      }
      const modulePath = discoveryFileUrlToPath(file, context);
      const bundledModuleCode = await bundleHandlerModuleForIsolation({
        projectDir: ctx.projectDir,
        modulePath,
        adapter: ctx.adapter,
        config: ctx.config,
      });
      throwIfAborted(signal);
      const moduleCode = virtualizeProjectBundlePaths(bundledModuleCode, ctx.projectDir);
      const bytes = encoder.encode(moduleCode).byteLength;
      if (bytes > MAX_PROJECT_RUN_WORKER_MODULE_BYTES) {
        throw new RangeError("Project run module exceeds the size limit");
      }
      totalBytes += bytes;
      if (totalBytes > MAX_PROJECT_RUN_WORKER_TOTAL_MODULE_BYTES) {
        throw new RangeError("Project run module payload exceeds the total size limit");
      }
      modules.push({
        ...createVirtualModuleLocation(
          modulePath,
          directory,
          ctx.projectDir,
          config.baseDir === "",
        ),
        moduleCode,
      });
    }
  }
  return { modules, virtualRoot: config.baseDir === "" };
}

function serializeEvalAgentAdapter(
  value: AgentServiceEvalAdapterConfig | undefined,
): ProjectRunWorkerEvalAgentAdapter {
  if (!value || typeof value.endpoint !== "string" || typeof value.authToken !== "string") {
    throw new TypeError("Remote eval agent adapter is required");
  }
  const result: ProjectRunWorkerEvalAgentAdapter = {
    endpoint: value.endpoint,
    authToken: value.authToken,
  };
  const optionalFields = [
    "agentId",
    "projectId",
    "projectSlug",
    "releaseId",
    "contentSourceId",
    "branchId",
    "branchName",
    "environment",
    "environmentId",
    "forwardedHost",
    "forwardedProto",
    "model",
  ] as const;
  for (const field of optionalFields) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") result[field] = fieldValue;
  }
  if (value.allowedTools !== undefined) result.allowedTools = [...value.allowedTools];
  if (value.maxSteps !== undefined) result.maxSteps = value.maxSteps;
  return result;
}

async function createWorkerKey(ctx: HandlerContext, requestId: string): Promise<string> {
  const identity = JSON.stringify([ctx.projectId ?? null, ctx.projectSlug ?? null, requestId]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(identity)));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `project-run:${hash}`;
}

async function executeEphemeralWorker(
  pool: ProjectRunWorkerPool,
  key: string,
  request: ExecuteProjectRunRequest,
  signal: AbortSignal,
): Promise<SerializedProjectRunResult> {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    pool.evictWorker(key);
    rejectAbort?.(signal.reason ?? new DOMException("Aborted", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await Promise.race([
      pool.execute(key, [], request),
      aborted,
    ]);
    throwIfAborted(signal);
    if (
      response.type !== "project-run-result" || response.id !== request.id
    ) {
      throw API_ERROR.create({ detail: "Isolated project run returned an invalid response" });
    }
    return snapshotProjectRunWorkerResult(response.result);
  } finally {
    signal.removeEventListener("abort", onAbort);
    pool.evictWorker(key);
  }
}

/** Bundle without host evaluation, then execute one remote task or eval in an ephemeral Worker. */
export async function executeIsolatedProjectRun(
  input: ExecuteIsolatedProjectRunInput,
  dependencies: ProjectRunIsolationDependencies = defaultDependencies,
): Promise<SerializedProjectRunResult> {
  throwIfAborted(input.req.signal);
  const { modules, virtualRoot } = await collectProjectRunModules(
    input.request,
    input.ctx,
    input.req.signal,
  );
  const datasetFiles = input.request.kind === "eval"
    ? await collectProjectDatasetFiles(input.ctx, virtualRoot, input.req.signal)
    : [];
  throwIfAborted(input.req.signal);
  const id = crypto.randomUUID();
  const base = {
    type: "execute-project-run" as const,
    id,
    projectDir: PROJECT_RUN_WORKER_VIRTUAL_ROOT,
    targetId: input.request.kind === "task"
      ? input.request.target.slice("task:".length)
      : input.request.target,
    modules,
    config: input.request.config ?? {},
    datasetFiles,
    sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
    projectEnv: getProjectEnvSnapshot(),
  };
  const request: ExecuteProjectRunRequest = input.request.kind === "task"
    ? {
      ...base,
      kind: "task",
      projectId: input.request.projectId,
      environmentId: input.request.runtimeTargetEnvironmentId === undefined
        ? input.ctx.environmentId
        : input.request.runtimeTargetEnvironmentId ?? undefined,
      debug: input.ctx.debug ?? false,
    }
    : {
      ...base,
      kind: "eval",
      runId: input.request.runId,
      evalAgentAdapter: serializeEvalAgentAdapter(input.evalAgentAdapter),
    };
  assertValidProjectRunWorkerRequest(request);
  const workerRequest = structuredClone(request);
  assertValidProjectRunWorkerRequest(workerRequest);

  try {
    return await executeEphemeralWorker(
      dependencies.getWorkerPool(),
      await createWorkerKey(input.ctx, id),
      workerRequest,
      input.req.signal,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw API_ERROR.create({ detail: "Isolated project run execution failed", cause: error });
  }
}
