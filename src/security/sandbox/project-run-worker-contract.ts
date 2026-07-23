import { parseSourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type {
  ExecuteProjectRunRequest,
  ProjectRunWorkerEvalAgentAdapter,
  SerializedProjectRunResult,
} from "./worker-types.ts";
import {
  MAX_PROJECT_RUN_WORKER_DATASET_BYTES,
  MAX_PROJECT_RUN_WORKER_DATASET_FILES,
  MAX_PROJECT_RUN_WORKER_ENV_BYTES,
  MAX_PROJECT_RUN_WORKER_ENV_ENTRIES,
  MAX_PROJECT_RUN_WORKER_JSON_BYTES,
  MAX_PROJECT_RUN_WORKER_MODULE_BYTES,
  MAX_PROJECT_RUN_WORKER_MODULES,
  MAX_PROJECT_RUN_WORKER_TOTAL_MODULE_BYTES,
} from "./worker-types.ts";

const encoder = new TextEncoder();
const encodeUtf8 = encoder.encode.bind(encoder);
const arrayIsArray = Array.isArray;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectEntries = Object.entries;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const stringSlice = String.prototype.slice;
const MAX_ID_LENGTH = 4_096;
const MAX_PATH_LENGTH = 4_096;
const MAX_DISCOVERY_DIR_LENGTH = 1_024;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 256 * 1_024;
const MAX_ADAPTER_TEXT_LENGTH = 65_536;
const MAX_ALLOWED_TOOLS = 1_000;
const MAX_EVAL_STEPS = 1_000;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Stable path namespace exposed to untrusted project-run code. */
export const PROJECT_RUN_WORKER_VIRTUAL_ROOT = "/project";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) return false;
  try {
    const prototype = objectGetPrototypeOf(value);
    return prototype === null || prototype === objectPrototype;
  } catch {
    return false;
  }
}

function hasOwnFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => objectHasOwn(value, field));
}

function byteLength(value: string): number {
  return encodeUtf8(value).byteLength;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximumLength ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

function assertProjectRelativePath(value: unknown, label: string): asserts value is string {
  assertBoundedText(value, label, MAX_PATH_LENGTH);
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a project-relative path`);
  }
}

function stringifyJsonWithinLimit(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = jsonStringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable`);
  }
  if (serialized === undefined || byteLength(serialized) > MAX_PROJECT_RUN_WORKER_JSON_BYTES) {
    throw new RangeError(`${label} exceeds the transfer limit`);
  }
  return serialized;
}

function assertJsonWithinLimit(value: unknown, label: string): void {
  stringifyJsonWithinLimit(value, label);
}

function assertProjectEnvironment(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new TypeError("Project environment must be an object");
  const entries = objectEntries(value);
  if (entries.length > MAX_PROJECT_RUN_WORKER_ENV_ENTRIES) {
    throw new RangeError("Project environment entry count exceeds the limit");
  }
  let bytes = 0;
  for (const [key, entryValue] of entries) {
    if (
      key.length === 0 || key.length > MAX_ENV_KEY_LENGTH || !ENV_KEY_PATTERN.test(key) ||
      typeof entryValue !== "string" || entryValue.length > MAX_ENV_VALUE_LENGTH
    ) {
      throw new TypeError("Project environment contains an invalid entry");
    }
    bytes += byteLength(key) + byteLength(entryValue);
    if (bytes > MAX_PROJECT_RUN_WORKER_ENV_BYTES) {
      throw new RangeError("Project environment exceeds the transfer limit");
    }
  }
}

function assertEvalAdapter(value: unknown): asserts value is ProjectRunWorkerEvalAgentAdapter {
  if (!isRecord(value) || !hasOwnFields(value, ["endpoint", "authToken"])) {
    throw new TypeError("Eval agent adapter must be an object");
  }
  assertBoundedText(value.endpoint, "Eval agent endpoint", 2_048);
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new TypeError("Eval agent endpoint is invalid");
  }
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    endpoint.pathname !== "/api/ag-ui"
  ) {
    throw new TypeError("Eval agent endpoint is invalid");
  }
  assertBoundedText(value.authToken, "Eval agent auth token", MAX_ADAPTER_TEXT_LENGTH);

  const optionalTextFields = [
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
  for (const field of optionalTextFields) {
    const fieldValue = objectHasOwn(value, field) ? value[field] : undefined;
    if (fieldValue !== undefined) {
      assertBoundedText(fieldValue, `Eval agent ${field}`, MAX_ADAPTER_TEXT_LENGTH);
    }
  }
  if (objectHasOwn(value, "allowedTools") && value.allowedTools !== undefined) {
    if (!arrayIsArray(value.allowedTools) || value.allowedTools.length > MAX_ALLOWED_TOOLS) {
      throw new TypeError("Eval agent allowedTools is invalid");
    }
    for (const tool of value.allowedTools) {
      assertBoundedText(tool, "Eval agent tool", 256);
    }
  }
  if (
    objectHasOwn(value, "maxSteps") && value.maxSteps !== undefined &&
    (typeof value.maxSteps !== "number" || !numberIsSafeInteger(value.maxSteps) ||
      value.maxSteps <= 0 || value.maxSteps > MAX_EVAL_STEPS)
  ) {
    throw new TypeError("Eval agent maxSteps is invalid");
  }
}

/** Validate an untrusted project-run message before any project module is evaluated. */
export function assertValidProjectRunWorkerRequest(
  value: unknown,
): asserts value is ExecuteProjectRunRequest {
  if (
    !isRecord(value) ||
    !hasOwnFields(value, [
      "type",
      "id",
      "projectDir",
      "targetId",
      "config",
      "sourceIntegrationPolicy",
      "modules",
      "datasetFiles",
      "kind",
    ]) || value.type !== "execute-project-run"
  ) {
    throw new TypeError("Project run worker request is invalid");
  }
  assertBoundedText(value.id, "Project run request id", 256);
  assertBoundedText(value.projectDir, "Project directory", MAX_PATH_LENGTH);
  assertBoundedText(value.targetId, "Project run target id");
  if (!isRecord(value.config)) throw new TypeError("Project run config must be an object");
  assertJsonWithinLimit(value.config, "Project run config");
  parseSourceIntegrationPolicyManifest(value.sourceIntegrationPolicy);
  assertProjectEnvironment(objectHasOwn(value, "projectEnv") ? value.projectEnv : undefined);

  if (!arrayIsArray(value.modules) || value.modules.length > MAX_PROJECT_RUN_WORKER_MODULES) {
    throw new RangeError("Project run module count exceeds the limit");
  }
  let moduleBytes = 0;
  for (const module of value.modules) {
    if (!isRecord(module) || !hasOwnFields(module, ["file", "dir", "moduleCode"])) {
      throw new TypeError("Project run module is invalid");
    }
    assertBoundedText(module.file, "Project run module file", MAX_PATH_LENGTH);
    assertBoundedText(module.dir, "Project run module directory", MAX_DISCOVERY_DIR_LENGTH);
    if (typeof module.moduleCode !== "string") {
      throw new TypeError("Project run module code is invalid");
    }
    const bytes = byteLength(module.moduleCode);
    if (bytes > MAX_PROJECT_RUN_WORKER_MODULE_BYTES) {
      throw new RangeError("Project run module exceeds the size limit");
    }
    moduleBytes += bytes;
    if (moduleBytes > MAX_PROJECT_RUN_WORKER_TOTAL_MODULE_BYTES) {
      throw new RangeError("Project run module payload exceeds the total size limit");
    }
  }

  if (
    !arrayIsArray(value.datasetFiles) ||
    value.datasetFiles.length > MAX_PROJECT_RUN_WORKER_DATASET_FILES
  ) {
    throw new RangeError("Project run dataset file count exceeds the limit");
  }
  let datasetBytes = 0;
  const datasetPaths = new Set<string>();
  for (const file of value.datasetFiles) {
    if (!isRecord(file) || !hasOwnFields(file, ["path", "content"])) {
      throw new TypeError("Project run dataset file is invalid");
    }
    assertProjectRelativePath(file.path, "Project run dataset path");
    if (datasetPaths.has(file.path)) {
      throw new TypeError("Project run dataset paths must be unique");
    }
    datasetPaths.add(file.path);
    if (typeof file.content !== "string") {
      throw new TypeError("Project run dataset content is invalid");
    }
    datasetBytes += byteLength(file.content);
    if (datasetBytes > MAX_PROJECT_RUN_WORKER_DATASET_BYTES) {
      throw new RangeError("Project run dataset payload exceeds the size limit");
    }
  }

  if (value.kind === "task") {
    if (!hasOwnFields(value, ["projectId", "debug"])) {
      throw new TypeError("Project run task request is invalid");
    }
    assertBoundedText(value.projectId, "Task project id", 1_024);
    if (objectHasOwn(value, "environmentId") && value.environmentId !== undefined) {
      assertBoundedText(value.environmentId, "Task environment id", 1_024);
    }
    if (typeof value.debug !== "boolean") throw new TypeError("Task debug flag is invalid");
    return;
  }
  if (value.kind === "eval") {
    if (!hasOwnFields(value, ["runId", "evalAgentAdapter"])) {
      throw new TypeError("Project run eval request is invalid");
    }
    assertBoundedText(value.runId, "Eval run id", 128);
    assertEvalAdapter(value.evalAgentAdapter);
    return;
  }
  throw new TypeError("Project run kind is invalid");
}

/** JSON-detach and bound a result before it crosses the Worker boundary. */
export function snapshotProjectRunWorkerResult(value: unknown): SerializedProjectRunResult {
  if (
    !isRecord(value) || !hasOwnFields(value, ["success", "durationMs"]) ||
    typeof value.success !== "boolean"
  ) {
    throw new TypeError("Project run result is invalid");
  }
  if (
    typeof value.durationMs !== "number" || !numberIsFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    throw new TypeError("Project run duration is invalid");
  }
  const error = objectHasOwn(value, "error") ? value.error : undefined;
  if (error !== undefined && typeof error !== "string") {
    throw new TypeError("Project run error is invalid");
  }
  // Keep the transport envelope off Object.prototype. Project code can mutate
  // that prototype before returning, including installing a hostile toJSON
  // hook that would otherwise rewrite or recursively serialize this envelope.
  const snapshot = objectCreate(null) as SerializedProjectRunResult;
  snapshot.success = value.success;
  snapshot.durationMs = value.durationMs;
  if (objectHasOwn(value, "result")) snapshot.result = value.result;
  if (typeof error === "string") snapshot.error = stringSlice.call(error, 0, 16_384);
  return jsonParse(
    stringifyJsonWithinLimit(snapshot, "Project run result"),
  ) as SerializedProjectRunResult;
}
