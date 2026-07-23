import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import {
  serializeSignedRequestJsonResponse,
  type SignedRequestJsonResponse,
} from "./signed-request-idempotency.ts";
import type { ProjectRunExecuteRequest, ProjectRunExecuteResponse } from "./project-run-types.ts";

const MAX_PROJECT_ID_LENGTH = 256;
const MAX_PROJECT_TARGET_LENGTH = 4_096;
const MAX_RUNTIME_TARGET_ID_LENGTH = 4_096;
const MAX_RUNTIME_AG_UI_ENDPOINT_LENGTH = 2_048;
const MAX_PROJECT_RUN_DIAGNOSTIC_LENGTH = 65_536;
const MAX_PROJECT_RUN_RESPONSE_BYTES = 16 * 1024 * 1024;
const PROJECT_RUN_RESPONSE_NOT_SERIALIZABLE_ERROR = "Project run response is not serializable";
const PROJECT_RUN_RESPONSE_TOO_LARGE_ERROR = "Project run response exceeds the supported limit";
const responseEncoder = new TextEncoder();

export function isProjectRunRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isProjectRunRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });
  }
  return value;
}

function parseBoundedString(value: unknown, fieldName: string, maxLength: number): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    value.trim() !== value || [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
  return value;
}

function parseOptionalUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  const endpoint = parseBoundedString(value, fieldName, MAX_RUNTIME_AG_UI_ENDPOINT_LENGTH);
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
    }
    return url.toString();
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
}

function parseRuntimeTargetKind(
  value: unknown,
): ProjectRunExecuteRequest["runtimeTargetKind"] {
  if (value === undefined || value === null) return undefined;
  if (value === "main_branch" || value === "environment" || value === "preview_branch") {
    return value;
  }
  throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtimeTargetKind" });
}

function parseOptionalNullableString(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseBoundedString(value, fieldName, MAX_RUNTIME_TARGET_ID_LENGTH);
}

function validateRuntimeTargetSelection(
  runtimeTargetKind: ProjectRunExecuteRequest["runtimeTargetKind"],
  runtimeTargetEnvironmentId: string | null | undefined,
  runtimeTargetBranchId: string | null | undefined,
): void {
  if (!runtimeTargetKind || runtimeTargetKind === "main_branch") {
    if (runtimeTargetEnvironmentId || runtimeTargetBranchId) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtime target selection" });
    }
    return;
  }
  if (runtimeTargetKind === "environment") {
    if (!runtimeTargetEnvironmentId || runtimeTargetBranchId) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtime target selection" });
    }
    return;
  }
  if (!runtimeTargetBranchId || runtimeTargetEnvironmentId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtime target selection" });
  }
}

export function parseProjectRunExecuteRequest(
  value: unknown,
  pathRunId: string,
): ProjectRunExecuteRequest {
  if (!isProjectRunRecord(value)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });
  }

  const runId = parseBoundedString(value.runId, "runId", 128);
  const kind = value.kind;
  const target = parseBoundedString(value.target, "target", MAX_PROJECT_TARGET_LENGTH);
  const projectId = parseBoundedString(value.projectId, "projectId", MAX_PROJECT_ID_LENGTH);
  if (runId !== pathRunId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Run id does not match request path" });
  }
  if (kind !== "task" && kind !== "workflow" && kind !== "eval") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid run kind" });
  }
  if (kind === "task" && (!target.startsWith("task:") || target.length === "task:".length)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid task target" });
  }
  if (
    kind === "workflow" &&
    (!target.startsWith("workflow:") || target.length === "workflow:".length)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid workflow target" });
  }
  if (kind === "eval" && (!target.startsWith("eval:") || target.length === "eval:".length)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid eval target" });
  }

  const runtimeTargetKind = parseRuntimeTargetKind(value.runtimeTargetKind);
  const runtimeTargetEnvironmentId = parseOptionalNullableString(
    value.runtimeTargetEnvironmentId,
    "runtimeTargetEnvironmentId",
  );
  const runtimeTargetBranchId = parseOptionalNullableString(
    value.runtimeTargetBranchId,
    "runtimeTargetBranchId",
  );
  validateRuntimeTargetSelection(
    runtimeTargetKind,
    runtimeTargetEnvironmentId,
    runtimeTargetBranchId,
  );

  return {
    runId,
    kind,
    target,
    projectId,
    runtimeAgUiEndpoint: parseOptionalUrl(value.runtimeAgUiEndpoint, "runtimeAgUiEndpoint"),
    runtimeTargetKind,
    runtimeTargetEnvironmentId,
    runtimeTargetBranchId,
    config: parseRecord(value.config),
    input: parseRecord(value.input),
  };
}

export function projectRunErrorMessage(error: unknown): string {
  let message = "Project run execution failed";
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    try {
      if (typeof error.message === "string" && error.message.length > 0) message = error.message;
    } catch {
      // Keep the stable fallback when an untrusted error has a throwing accessor.
    }
  }
  return sanitizeErrorText(message, MAX_PROJECT_RUN_DIAGNOSTIC_LENGTH) ||
    "Project run execution failed";
}

export function normalizeProjectRunDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(value, Number.MAX_SAFE_INTEGER))
    : 0;
}

export function createProjectRunExecutionFailure(
  error: unknown,
  durationMs: number,
): ProjectRunExecuteResponse {
  return {
    success: false,
    error: projectRunErrorMessage(error),
    logs: null,
    duration_ms: durationMs,
  };
}

function normalizeExecutionResponse(
  response: ProjectRunExecuteResponse,
): ProjectRunExecuteResponse {
  const normalized = { ...response };
  if (response.error !== undefined && response.error !== null) {
    normalized.error = projectRunErrorMessage(response.error);
  }
  if (response.logs !== undefined && response.logs !== null) {
    normalized.logs = sanitizeErrorText(response.logs, MAX_PROJECT_RUN_DIAGNOSTIC_LENGTH);
  }
  if (response.duration_ms !== undefined) {
    normalized.duration_ms = normalizeProjectRunDuration(response.duration_ms);
  }
  return normalized;
}

function readExecutionResponseDuration(response: ProjectRunExecuteResponse): number {
  try {
    return normalizeProjectRunDuration(response.duration_ms);
  } catch {
    return 0;
  }
}

function serializeExecutionFailure(
  error: string,
  durationMs: number,
): SignedRequestJsonResponse {
  return serializeSignedRequestJsonResponse(
    {
      success: false,
      error,
      logs: null,
      duration_ms: normalizeProjectRunDuration(durationMs),
    } satisfies ProjectRunExecuteResponse,
    200,
  );
}

export function serializeProjectRunExecutionResponse(
  response: ProjectRunExecuteResponse,
): SignedRequestJsonResponse {
  let serialized: SignedRequestJsonResponse;
  try {
    serialized = serializeSignedRequestJsonResponse(normalizeExecutionResponse(response), 200);
  } catch {
    return serializeExecutionFailure(
      PROJECT_RUN_RESPONSE_NOT_SERIALIZABLE_ERROR,
      readExecutionResponseDuration(response),
    );
  }
  if (responseEncoder.encode(serialized.body).byteLength > MAX_PROJECT_RUN_RESPONSE_BYTES) {
    return serializeExecutionFailure(
      PROJECT_RUN_RESPONSE_TOO_LARGE_ERROR,
      readExecutionResponseDuration(response),
    );
  }
  return serialized;
}
