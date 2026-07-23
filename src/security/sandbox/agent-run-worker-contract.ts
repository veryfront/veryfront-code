import type { RuntimeAgentTargetSelectionInput } from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import {
  getInternalAgentStreamRequestSchema,
  type InternalAgentStreamRequest,
} from "#veryfront/internal-agents/schema.ts";
import {
  parseSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import {
  assertValidProjectConfigModule,
  type ProjectConfigModule,
} from "./project-config-module.ts";
import {
  assertValidProjectSourceSnapshot,
  PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES,
  PROJECT_SOURCE_SNAPSHOT_MAX_FILES,
  PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_BYTES,
  type ProjectSourceSnapshot,
  verifyProjectSourceSnapshot,
} from "./project-source-snapshot.ts";
import type { AgentProjectConfigProjection } from "./project-config-worker-runtime.ts";

const encoder = new TextEncoder();
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROTOCOL_GRAPH_DEPTH = 128;
const MAX_PROTOCOL_GRAPH_ENTRIES = 200_000;
const MAX_PROTOCOL_OBJECT_KEYS = 50_000;

export const AGENT_RUN_WORKER_PROTOCOL_VERSION = 1;
export const AGENT_RUN_WORKER_MAX_MODULES = 1_000;
export const AGENT_RUN_WORKER_MAX_MODULE_BYTES = 4 * 1024 * 1024;
export const AGENT_RUN_WORKER_MAX_TOTAL_MODULE_BYTES = 32 * 1024 * 1024;
export const AGENT_RUN_WORKER_MAX_SOURCE_FILES = PROJECT_SOURCE_SNAPSHOT_MAX_FILES;
export const AGENT_RUN_WORKER_MAX_SOURCE_FILE_BYTES = PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES;
export const AGENT_RUN_WORKER_MAX_TOTAL_SOURCE_BYTES = PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_BYTES;
export const AGENT_RUN_WORKER_MAX_PROJECT_ENV_KEYS = 512;
export const AGENT_RUN_WORKER_MAX_PROJECT_ENV_BYTES = 2 * 1024 * 1024;
export const AGENT_RUN_WORKER_MAX_FRAME_BYTES = 64 * 1024;
export const AGENT_RUN_WORKER_MAX_CREDIT_BYTES = 256 * 1024;
export const AGENT_RUN_WORKER_MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;

export type AgentRunDiscoveryConcept = "agent" | "tool";

export interface AgentRunExecutionModule {
  concepts: AgentRunDiscoveryConcept[];
  sourcePath: string;
  moduleCode: string;
}

export interface AgentRunIdentity {
  runId: string;
  agentId: string;
  projectId: string;
  projectSlug: string;
  runtimeTarget: RuntimeAgentTargetSelectionInput;
}

export interface AgentRunExecutionDiscoveryManifest {
  agentDirs: string[];
  toolDirs: string[];
  skillDirs: string[];
  modules: AgentRunExecutionModule[];
}

export interface AgentRunWorkerPreparationRequest {
  type: "prepare-agent-run";
  schemaVersion: typeof AGENT_RUN_WORKER_PROTOCOL_VERSION;
  preparationId: string;
  sourceDigest: string;
  configModule?: ProjectConfigModule;
}

export interface AgentRunWorkerPreparationResponse {
  type: "agent-run-prepared";
  schemaVersion: typeof AGENT_RUN_WORKER_PROTOCOL_VERSION;
  preparationId: string;
  sourceDigest: string;
  projection: AgentProjectConfigProjection;
}

export interface AgentRunExecutionBundle {
  schemaVersion: typeof AGENT_RUN_WORKER_PROTOCOL_VERSION;
  preparationId: string;
  run: AgentRunIdentity;
  request: InternalAgentStreamRequest;
  sourceSnapshot: ProjectSourceSnapshot;
  discovery: AgentRunExecutionDiscoveryManifest;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  projectEnv?: Record<string, string>;
  framework: {
    apiUrl: string;
    authToken?: string;
    projectId: string;
    studioMcpUrl?: string;
  };
}

export interface AgentRunSourceBinding {
  projectId: string;
  projectSlug: string;
  agentSource: InternalAgentStreamRequest["agentSource"];
  runtimeTarget: RuntimeAgentTargetSelectionInput;
}

export interface AgentRunResumeWorkerCommand {
  type: "agent-run-resume";
  commandId: string;
  runId: string;
  toolCallId: string;
  result: unknown;
  isError: boolean;
}

export interface AgentRunCancelWorkerCommand {
  type: "agent-run-cancel";
  commandId: string;
  runId: string;
}

export interface AgentRunDetachWorkerCommand {
  type: "agent-run-detach";
  commandId: string;
  runId: string;
}

export interface AgentRunStreamCreditCommand {
  type: "agent-stream-credit";
  commandId: string;
  runId: string;
  bytes: number;
}

export type AgentRunWorkerControlCommand =
  | AgentRunResumeWorkerCommand
  | AgentRunCancelWorkerCommand
  | AgentRunDetachWorkerCommand
  | AgentRunStreamCreditCommand;

export type AgentRunWorkerControlOperation = "resume" | "cancel" | "detach";

export type AgentRunWorkerControlErrorCode =
  | "RUN_NOT_ACTIVE"
  | "TOOL_RESULT_CONFLICT"
  | "TOOL_RESULT_NOT_WAITING"
  | "INVALID_CONTROL_COMMAND"
  | "WORKER_CONTROL_FAILED";

export type AgentRunWorkerControlResult =
  | {
    type: "agent-run-control-result";
    commandId: string;
    runId: string;
    operation: AgentRunWorkerControlOperation;
    ok: true;
    accepted: boolean;
    duplicate?: true;
  }
  | {
    type: "agent-run-control-result";
    commandId: string;
    runId: string;
    operation: AgentRunWorkerControlOperation;
    ok: false;
    errorCode: AgentRunWorkerControlErrorCode;
  };

export interface AgentRunWorkerStreamStarted {
  type: "agent-stream-started";
  id: string;
  runId: string;
}

export interface AgentRunWorkerStreamChunk {
  type: "agent-stream-chunk";
  id: string;
  runId: string;
  chunk: Uint8Array;
}

export interface AgentRunWorkerStreamEnd {
  type: "agent-stream-end";
  id: string;
  runId: string;
  status: "completed" | "cancelled" | "failed";
}

export interface AgentRunWorkerStreamError {
  type: "agent-stream-error";
  id: string;
  runId: string;
  errorCode:
    | "AGENT_NOT_FOUND"
    | "INVALID_EXECUTION_BUNDLE"
    | "DISCOVERY_FAILED"
    | "EXECUTION_FAILED";
}

export type AgentRunWorkerEvent =
  | AgentRunWorkerControlResult
  | AgentRunWorkerStreamStarted
  | AgentRunWorkerStreamChunk
  | AgentRunWorkerStreamEnd
  | AgentRunWorkerStreamError;

/** Reject unsupported primitives, prototypes, accessors, sparse arrays, symbols, and cycles. */
export function assertPlainAgentRunProtocolData(value: unknown, label: string): void {
  const active = new WeakSet<object>();
  let entries = 0;

  function visit(candidate: unknown, depth: number): void {
    if (candidate === null) return;
    const candidateType = typeof candidate;
    if (typeof candidate !== "object") {
      if (candidateType === "number" && !Number.isFinite(candidate)) {
        throw new TypeError(`${label} must contain only finite numbers`);
      }
      if (
        candidateType === "undefined" || candidateType === "bigint" ||
        candidateType === "symbol" || candidateType === "function"
      ) {
        throw new TypeError(`${label} contains an unsupported value`);
      }
      return;
    }
    if (candidate instanceof Uint8Array) {
      if (Object.getPrototypeOf(candidate) !== Uint8Array.prototype) {
        throw new TypeError(`${label} must contain only standard byte arrays`);
      }
      return;
    }
    if (depth > MAX_PROTOCOL_GRAPH_DEPTH) {
      throw new RangeError(`${label} exceeds the supported nesting depth`);
    }
    if (active.has(candidate)) throw new TypeError(`${label} must not contain cycles`);

    let prototype: object | null;
    let keys: (string | symbol)[];
    try {
      prototype = Object.getPrototypeOf(candidate);
      keys = Reflect.ownKeys(candidate);
    } catch {
      throw new TypeError(`${label} must contain inspectable plain data`);
    }
    const isArray = Array.isArray(candidate);
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      throw new TypeError(`${label} must contain only plain data`);
    }
    if (keys.length > MAX_PROTOCOL_OBJECT_KEYS) {
      throw new RangeError(`${label} contains too many object keys`);
    }
    entries += keys.length;
    if (entries > MAX_PROTOCOL_GRAPH_ENTRIES) {
      throw new RangeError(`${label} contains too many data entries`);
    }

    active.add(candidate);
    try {
      for (const key of keys) {
        if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
        if (isArray && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${label} must contain only enumerable data properties`);
        }
        visit(descriptor.value, depth + 1);
      }
      if (isArray) {
        const array = candidate as unknown[];
        const indexKeys = keys.filter((key) => key !== "length");
        if (indexKeys.length !== array.length) {
          throw new TypeError(`${label} must contain only dense arrays`);
        }
        for (let index = 0; index < array.length; index++) {
          if (!Object.hasOwn(array, index)) {
            throw new TypeError(`${label} must contain only dense arrays`);
          }
        }
      }
    } finally {
      active.delete(candidate);
    }
  }

  visit(value, 0);
}

function assertExactKeys(
  value: object,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains an unsupported property`);
  }
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxCharacters: number,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxCharacters) {
    throw new TypeError(`${label} is invalid`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw new TypeError(`${label} is invalid`);
  }
}

function assertRunId(value: unknown): asserts value is string {
  assertBoundedString(value, "Agent run id", 128);
  if (!RUN_ID_PATTERN.test(value)) throw new TypeError("Agent run id is invalid");
}

function assertCommandId(value: unknown): asserts value is string {
  assertBoundedString(value, "Agent run command id", 128);
  if (!UUID_PATTERN.test(value)) throw new TypeError("Agent run command id is invalid");
}

function assertProjectRelativePath(value: unknown, label: string): asserts value is string {
  assertBoundedString(value, label, 16_384);
  const segments = value.split("/");
  if (
    value.includes("\\") || value.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be canonical and project-relative`);
  }
}

function assertRuntimeTarget(target: RuntimeAgentTargetSelectionInput): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("Agent run target is invalid");
  }
  assertExactKeys(
    target,
    ["runtimeTargetKind", "runtimeTargetEnvironmentId", "runtimeTargetBranchId"],
    "Agent run target",
  );
  const kind = target.runtimeTargetKind ?? "main_branch";
  if (!new Set(["main_branch", "environment", "preview_branch"]).has(kind)) {
    throw new TypeError("Agent run target is invalid");
  }
  const environmentId = target.runtimeTargetEnvironmentId ?? null;
  const branchId = target.runtimeTargetBranchId ?? null;
  if (environmentId !== null && !UUID_PATTERN.test(environmentId)) {
    throw new TypeError("Agent run target environment is invalid");
  }
  if (branchId !== null && !UUID_PATTERN.test(branchId)) {
    throw new TypeError("Agent run target branch is invalid");
  }
  if (
    (kind === "main_branch" && (environmentId !== null || branchId !== null)) ||
    (kind === "environment" && (environmentId === null || branchId !== null)) ||
    (kind === "preview_branch" && (branchId === null || environmentId !== null))
  ) {
    throw new TypeError("Agent run target is invalid");
  }
}

function assertRunIdentity(run: AgentRunIdentity): void {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new TypeError("Agent run identity is invalid");
  }
  assertExactKeys(
    run,
    ["runId", "agentId", "projectId", "projectSlug", "runtimeTarget"],
    "Agent run identity",
  );
  assertRunId(run.runId);
  assertBoundedString(run.agentId, "Agent id", 128);
  assertBoundedString(run.projectId, "Agent run project id", 128);
  if (!UUID_PATTERN.test(run.projectId)) throw new TypeError("Agent run project id is invalid");
  assertBoundedString(run.projectSlug, "Agent run project slug", 255);
  assertRuntimeTarget(run.runtimeTarget);
}

function assertRequestMatchesRun(
  requestValue: InternalAgentStreamRequest,
  run: AgentRunIdentity,
): InternalAgentStreamRequest {
  const request = getInternalAgentStreamRequestSchema().parse(requestValue);
  if (request.runId !== run.runId) {
    throw new TypeError("Agent run request run id does not match the execution bundle");
  }
  if (request.agentId !== run.agentId) {
    throw new TypeError("Agent run request agent id does not match the execution bundle");
  }
  return request;
}

function assertDiscoveryDirectories(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new RangeError(`${label} count exceeds the supported limit`);
  }
  const seen = new Set<string>();
  for (const path of value) {
    assertProjectRelativePath(path, label);
    if (seen.has(path)) throw new TypeError(`${label} contains a duplicate path`);
    seen.add(path);
  }
}

function assertDiscoveryManifest(
  manifest: AgentRunExecutionDiscoveryManifest,
  sourcePaths: ReadonlySet<string>,
): void {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Agent run discovery manifest is invalid");
  }
  assertExactKeys(
    manifest,
    ["agentDirs", "toolDirs", "skillDirs", "modules"],
    "Agent run discovery manifest",
  );
  assertDiscoveryDirectories(manifest.agentDirs, "Agent discovery directory");
  assertDiscoveryDirectories(manifest.toolDirs, "Tool discovery directory");
  assertDiscoveryDirectories(manifest.skillDirs, "Skill discovery directory");

  if (!Array.isArray(manifest.modules) || manifest.modules.length > AGENT_RUN_WORKER_MAX_MODULES) {
    throw new RangeError("Agent run module count exceeds the supported limit");
  }
  let totalModuleBytes = 0;
  let previousModulePath: string | undefined;
  for (const module of manifest.modules) {
    if (!module || !Array.isArray(module.concepts) || module.concepts.length === 0) {
      throw new TypeError("Agent run module concepts are invalid");
    }
    assertExactKeys(
      module,
      ["concepts", "sourcePath", "moduleCode"],
      "Agent run module",
    );
    const concepts = [...new Set(module.concepts)];
    if (
      concepts.length !== module.concepts.length ||
      concepts.some((concept) => concept !== "agent" && concept !== "tool") ||
      concepts.join(",") !== [...concepts].sort().join(",")
    ) {
      throw new TypeError("Agent run module concepts are invalid");
    }
    assertProjectRelativePath(module.sourcePath, "Agent run module path");
    if (previousModulePath !== undefined && module.sourcePath <= previousModulePath) {
      throw new TypeError("Agent run module manifest paths must be unique and sorted");
    }
    previousModulePath = module.sourcePath;
    if (!sourcePaths.has(module.sourcePath)) {
      throw new TypeError("Agent run module path is absent from the source snapshot");
    }
    if (typeof module.moduleCode !== "string" || module.moduleCode.length === 0) {
      throw new TypeError("Agent run module code is invalid");
    }
    const moduleBytes = byteLength(module.moduleCode);
    if (moduleBytes > AGENT_RUN_WORKER_MAX_MODULE_BYTES) {
      throw new RangeError("Agent run module exceeds the supported byte limit");
    }
    totalModuleBytes += moduleBytes;
    if (totalModuleBytes > AGENT_RUN_WORKER_MAX_TOTAL_MODULE_BYTES) {
      throw new RangeError("Agent run modules exceed the supported total byte limit");
    }
  }
}

function assertProjectEnv(env: Record<string, string> | undefined): void {
  if (env === undefined) return;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("Agent run project environment is invalid");
  }
  const entries = Object.entries(env);
  if (entries.length > AGENT_RUN_WORKER_MAX_PROJECT_ENV_KEYS) {
    throw new RangeError("Agent run project environment exceeds the key limit");
  }
  let totalBytes = 0;
  for (const [key, value] of entries) {
    if (!ENV_KEY_PATTERN.test(key) || key.length > 256 || typeof value !== "string") {
      throw new TypeError("Agent run project environment is invalid");
    }
    totalBytes += byteLength(key) + byteLength(value);
    if (totalBytes > AGENT_RUN_WORKER_MAX_PROJECT_ENV_BYTES) {
      throw new RangeError("Agent run project environment exceeds the byte limit");
    }
  }
}

function assertHttpUrl(value: unknown, label: string): asserts value is string {
  assertBoundedString(value, label, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username || parsed.password
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

function assertSourceDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError("Agent run source digest is invalid");
  }
}

function assertAgentProjectConfigProjection(value: AgentProjectConfigProjection): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent project config projection is invalid");
  }
  assertExactKeys(
    value,
    ["agentDirs", "toolDirs", "skillDirs", "sourceIntegrationPolicy"],
    "Agent project config projection",
  );
  assertDiscoveryDirectories(value.agentDirs, "Agent discovery directory");
  assertDiscoveryDirectories(value.toolDirs, "Tool discovery directory");
  assertDiscoveryDirectories(value.skillDirs, "Skill discovery directory");
  parseSourceIntegrationPolicyManifest(value.sourceIntegrationPolicy);
}

export function assertValidAgentRunWorkerPreparationRequest(
  value: AgentRunWorkerPreparationRequest,
): asserts value is AgentRunWorkerPreparationRequest {
  assertPlainAgentRunProtocolData(value, "Agent run preparation request");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent run preparation request is invalid");
  }
  if (
    value.type !== "prepare-agent-run" ||
    value.schemaVersion !== AGENT_RUN_WORKER_PROTOCOL_VERSION
  ) {
    throw new TypeError("Agent run preparation request version is invalid");
  }
  assertExactKeys(
    value,
    ["type", "schemaVersion", "preparationId", "sourceDigest", "configModule"],
    "Agent run preparation request",
  );
  assertCommandId(value.preparationId);
  assertSourceDigest(value.sourceDigest);
  if (value.configModule !== undefined) assertValidProjectConfigModule(value.configModule);
}

export function assertValidAgentRunWorkerPreparationResponse(
  value: AgentRunWorkerPreparationResponse,
  expected?: AgentRunWorkerPreparationRequest,
): asserts value is AgentRunWorkerPreparationResponse {
  assertPlainAgentRunProtocolData(value, "Agent run preparation response");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent run preparation response is invalid");
  }
  if (
    value.type !== "agent-run-prepared" ||
    value.schemaVersion !== AGENT_RUN_WORKER_PROTOCOL_VERSION
  ) {
    throw new TypeError("Agent run preparation response version is invalid");
  }
  assertExactKeys(
    value,
    ["type", "schemaVersion", "preparationId", "sourceDigest", "projection"],
    "Agent run preparation response",
  );
  assertCommandId(value.preparationId);
  assertSourceDigest(value.sourceDigest);
  assertAgentProjectConfigProjection(value.projection);
  if (
    expected && (
      value.preparationId !== expected.preparationId || value.sourceDigest !== expected.sourceDigest
    )
  ) {
    throw new TypeError("Agent run preparation response identity is invalid");
  }
}

export function assertValidAgentRunExecutionBundle(
  value: AgentRunExecutionBundle,
): asserts value is AgentRunExecutionBundle {
  assertPlainAgentRunProtocolData(value, "Agent run execution bundle");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent run execution bundle is invalid");
  }
  if (value.schemaVersion !== AGENT_RUN_WORKER_PROTOCOL_VERSION) {
    throw new TypeError("Agent run execution bundle version is invalid");
  }
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "preparationId",
      "run",
      "request",
      "sourceSnapshot",
      "discovery",
      "sourceIntegrationPolicy",
      "projectEnv",
      "framework",
    ],
    "Agent run execution bundle",
  );
  assertCommandId(value.preparationId);
  const run = value.run;
  assertRunIdentity(run);
  assertRequestMatchesRun(value.request, run);
  assertValidProjectSourceSnapshot(value.sourceSnapshot);
  assertDiscoveryManifest(
    value.discovery,
    new Set(value.sourceSnapshot.files.map((file) => file.sourcePath)),
  );
  parseSourceIntegrationPolicyManifest(value.sourceIntegrationPolicy);
  assertProjectEnv(value.projectEnv);

  const framework = value.framework;
  if (!framework || typeof framework !== "object" || Array.isArray(framework)) {
    throw new TypeError("Agent run framework context is invalid");
  }
  assertExactKeys(
    framework,
    ["apiUrl", "authToken", "projectId", "studioMcpUrl"],
    "Agent run framework context",
  );
  assertHttpUrl(framework.apiUrl, "Agent run API URL");
  if (framework.studioMcpUrl !== undefined) {
    assertHttpUrl(framework.studioMcpUrl, "Agent run Studio MCP URL");
  }
  if (framework.authToken !== undefined) {
    assertBoundedString(framework.authToken, "Agent run credential", 16_384);
  }
  if (framework.projectId !== run.projectId) {
    throw new TypeError("Agent run framework project id does not match the execution bundle");
  }
}

/** Verify content hashes after the synchronous process-boundary shape check. */
export async function verifyAgentRunExecutionBundleSource(
  value: AgentRunExecutionBundle,
): Promise<void> {
  assertValidAgentRunExecutionBundle(value);
  await verifyProjectSourceSnapshot(value.sourceSnapshot);
}

export function createAgentRunSourceBindingKey(
  value: Pick<AgentRunExecutionBundle, "run" | "request" | "sourceSnapshot">,
): string {
  return JSON.stringify({
    projectId: value.run.projectId,
    projectSlug: value.run.projectSlug,
    agentSource: value.request.agentSource,
    runtimeTarget: value.run.runtimeTarget,
    sourceDigest: value.sourceSnapshot.digest,
  });
}

export function assertValidAgentRunWorkerControlCommand(
  value: AgentRunWorkerControlCommand,
): asserts value is AgentRunWorkerControlCommand {
  assertPlainAgentRunProtocolData(value, "Agent run control command");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent run control command is invalid");
  }
  assertCommandId(value.commandId);
  assertRunId(value.runId);
  if (value.type === "agent-run-resume") {
    assertExactKeys(
      value,
      ["type", "commandId", "runId", "toolCallId", "result", "isError"],
      "Agent run resume command",
    );
    assertBoundedString(value.toolCallId, "Agent run tool call id", 128);
    if (typeof value.isError !== "boolean") {
      throw new TypeError("Agent run resume error marker is invalid");
    }
    let resultBytes: number;
    try {
      const serialized = JSON.stringify(value.result);
      if (serialized === undefined) throw new TypeError("Unsupported result");
      resultBytes = byteLength(serialized);
    } catch {
      throw new TypeError("Agent run resume result is not JSON serializable");
    }
    if (resultBytes > 65_536) {
      throw new RangeError("Agent run resume result exceeds the supported byte limit");
    }
    return;
  }
  if (value.type === "agent-run-cancel" || value.type === "agent-run-detach") {
    assertExactKeys(value, ["type", "commandId", "runId"], "Agent run control command");
    return;
  }
  if (value.type === "agent-stream-credit") {
    assertExactKeys(
      value,
      ["type", "commandId", "runId", "bytes"],
      "Agent stream credit command",
    );
    if (
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 ||
      value.bytes > AGENT_RUN_WORKER_MAX_CREDIT_BYTES
    ) {
      throw new RangeError("Agent stream credit exceeds the supported byte limit");
    }
    return;
  }
  throw new TypeError("Agent run control command type is invalid");
}

export function assertValidAgentRunWorkerControlResult(
  value: AgentRunWorkerControlResult,
): asserts value is AgentRunWorkerControlResult {
  assertPlainAgentRunProtocolData(value, "Agent run control result");
  if (!value || value.type !== "agent-run-control-result") {
    throw new TypeError("Agent run control result is invalid");
  }
  assertCommandId(value.commandId);
  assertRunId(value.runId);
  if (
    value.operation !== "resume" && value.operation !== "cancel" && value.operation !== "detach"
  ) {
    throw new TypeError("Agent run control result operation is invalid");
  }
  if (typeof value.ok !== "boolean") {
    throw new TypeError("Agent run control result outcome is invalid");
  }
  if (value.ok === true) {
    assertExactKeys(
      value,
      ["type", "commandId", "runId", "operation", "ok", "accepted", "duplicate"],
      "Agent run control result",
    );
    if (
      typeof value.accepted !== "boolean" ||
      (value.duplicate !== undefined && value.duplicate !== true)
    ) {
      throw new TypeError("Agent run control result outcome is invalid");
    }
    return;
  }
  assertExactKeys(
    value,
    ["type", "commandId", "runId", "operation", "ok", "errorCode"],
    "Agent run control result",
  );
  if (
    !new Set<AgentRunWorkerControlErrorCode>([
      "RUN_NOT_ACTIVE",
      "TOOL_RESULT_CONFLICT",
      "TOOL_RESULT_NOT_WAITING",
      "INVALID_CONTROL_COMMAND",
      "WORKER_CONTROL_FAILED",
    ]).has(value.errorCode)
  ) {
    throw new TypeError("Agent run control result error is invalid");
  }
}

export function assertValidAgentRunWorkerEvent(
  value: AgentRunWorkerEvent,
): asserts value is AgentRunWorkerEvent {
  assertPlainAgentRunProtocolData(value, "Agent run Worker event");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent run Worker event is invalid");
  }
  if (value.type === "agent-run-control-result") {
    assertValidAgentRunWorkerControlResult(value);
    return;
  }
  assertBoundedString(value.id, "Agent run Worker request id", 128);
  assertRunId(value.runId);
  if (value.type === "agent-stream-started") {
    assertExactKeys(value, ["type", "id", "runId"], "Agent run Worker start event");
    return;
  }
  if (value.type === "agent-stream-chunk") {
    assertExactKeys(
      value,
      ["type", "id", "runId", "chunk"],
      "Agent run Worker stream frame",
    );
    if (
      !(value.chunk instanceof Uint8Array) || value.chunk.byteLength === 0 ||
      value.chunk.byteLength > AGENT_RUN_WORKER_MAX_FRAME_BYTES
    ) {
      throw new RangeError("Agent run Worker stream frame is invalid");
    }
    return;
  }
  if (value.type === "agent-stream-end") {
    assertExactKeys(
      value,
      ["type", "id", "runId", "status"],
      "Agent run Worker terminal event",
    );
    if (
      value.status !== "completed" && value.status !== "cancelled" &&
      value.status !== "failed"
    ) {
      throw new TypeError("Agent run Worker terminal status is invalid");
    }
    return;
  }
  if (value.type === "agent-stream-error") {
    assertExactKeys(
      value,
      ["type", "id", "runId", "errorCode"],
      "Agent run Worker error event",
    );
    if (
      value.errorCode !== "AGENT_NOT_FOUND" &&
      value.errorCode !== "INVALID_EXECUTION_BUNDLE" &&
      value.errorCode !== "DISCOVERY_FAILED" &&
      value.errorCode !== "EXECUTION_FAILED"
    ) {
      throw new TypeError("Agent run Worker stream error is invalid");
    }
    return;
  }
  throw new TypeError("Agent run Worker event type is invalid");
}
