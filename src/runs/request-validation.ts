import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "#veryfront/utils/project-identity.ts";
import type { RunRuntimeTargetKind } from "./schemas.ts";

const MAX_RUNS_API_URL_CODE_UNITS = 2_048;
const MAX_RUNS_AUTH_TOKEN_CODE_UNITS = 16_384;
const RUN_RUNTIME_TARGET_KINDS = new Set<RunRuntimeTargetKind>([
  "main_branch",
  "environment",
  "preview_branch",
]);

/** Structural runtime-target input shared by request validation and the client API. */
export interface RuntimeTargetInput {
  runtimeTargetKind?: RunRuntimeTargetKind;
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
}

export function withoutUndefined(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function requireObject(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function optionalJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  requireObject(value, label);
  return value as Record<string, unknown>;
}

export function requireCanonicalString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a non-empty canonical string`);
  }
  return value;
}

export function optionalCanonicalString(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : requireCanonicalString(value, label);
}

export function requireOpaqueIdentifier(value: unknown, label: string): string {
  if (!isCanonicalOpaqueProjectIdentifier(value)) {
    throw new TypeError(`${label} must be a bounded non-empty canonical identifier`);
  }
  return value;
}

export function optionalOpaqueIdentifier(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : requireOpaqueIdentifier(value, label);
}

function nullableOpaqueIdentifier(value: unknown, label: string): string | undefined {
  return value == null ? undefined : requireOpaqueIdentifier(value, label);
}

export function optionalSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

export function requireRunTarget<TPrefix extends "task:" | "workflow:" | "eval:">(
  value: unknown,
  prefix: TPrefix,
): `${TPrefix}${string}` {
  const target = requireCanonicalString(value, "target");
  if (!target.startsWith(prefix) || target.length === prefix.length) {
    throw new TypeError(`target must use the ${prefix}<id> form`);
  }
  requireOpaqueIdentifier(target.slice(prefix.length), "target id");
  return target as `${TPrefix}${string}`;
}

export function runtimeTargetBody(input: RuntimeTargetInput): Record<string, unknown> {
  const kind = input.runtimeTargetKind;
  if (kind !== undefined && !RUN_RUNTIME_TARGET_KINDS.has(kind)) {
    throw new TypeError("runtimeTargetKind is not supported");
  }

  const environmentId = nullableOpaqueIdentifier(
    input.runtimeTargetEnvironmentId,
    "runtimeTargetEnvironmentId",
  );
  const branchId = nullableOpaqueIdentifier(
    input.runtimeTargetBranchId,
    "runtimeTargetBranchId",
  );

  switch (kind) {
    case undefined:
      if (environmentId !== undefined || branchId !== undefined) {
        throw new TypeError(
          "runtimeTargetKind is required when a runtime target identifier is provided",
        );
      }
      return {};
    case "main_branch":
      if (environmentId !== undefined || branchId !== undefined) {
        throw new TypeError("main_branch cannot include runtime target identifiers");
      }
      return { runtime_target_kind: kind };
    case "environment":
      if (environmentId === undefined) {
        throw new TypeError(
          "runtimeTargetEnvironmentId is required for an environment runtime target",
        );
      }
      if (branchId !== undefined) {
        throw new TypeError(
          "runtimeTargetBranchId cannot be used with an environment runtime target",
        );
      }
      return {
        runtime_target_kind: kind,
        runtime_target_environment_id: environmentId,
      };
    case "preview_branch":
      if (branchId === undefined) {
        throw new TypeError(
          "runtimeTargetBranchId is required for a preview_branch runtime target",
        );
      }
      if (environmentId !== undefined) {
        throw new TypeError(
          "runtimeTargetEnvironmentId cannot be used with a preview_branch runtime target",
        );
      }
      return {
        runtime_target_kind: kind,
        runtime_target_branch_id: branchId,
      };
  }
}

export function normalizeRunsApiBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RUNS_API_URL_CODE_UNITS ||
    value.trim() !== value ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Runs API URL must be a bounded non-empty canonical URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new TypeError("Runs API URL must be a valid absolute URL", { cause });
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(
      "Runs API URL must use HTTP(S) and cannot contain credentials, query, or fragment",
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

export function requireAuthToken(value: unknown, label = "authToken"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RUNS_AUTH_TOKEN_CODE_UNITS ||
    value.trim() !== value ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a bounded non-empty canonical credential`);
  }
  return value;
}

export function requireCanonicalStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  return value.map((entry, index) => requireCanonicalString(entry, `${label}[${index}]`));
}

export function requireOpaqueIdentifierArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  return value.map((entry, index) => requireOpaqueIdentifier(entry, `${label}[${index}]`));
}

export function serializeRunsRequestBody(body: Record<string, unknown>): string {
  const snapshot = snapshotBoundedJsonValue(body);
  if (!snapshot.success || Array.isArray(snapshot.value) || snapshot.value === null) {
    throw new TypeError(
      "Runs request body must be an acyclic, bounded, data-only JSON object",
    );
  }
  return JSON.stringify(snapshot.value);
}
