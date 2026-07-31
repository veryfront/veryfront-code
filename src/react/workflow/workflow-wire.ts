import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import {
  parseSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import type {
  Checkpoint,
  NodeState,
  PendingApproval,
  WorkflowContext,
  WorkflowError,
  WorkflowRun,
  WorkflowStatus,
} from "#veryfront/workflow/types.ts";

const MAX_WIRE_DEPTH = 32;
const MAX_WIRE_NODES = 10_000;
const MAX_WIRE_COLLECTION_ITEMS = 1_000;
const MAX_WIRE_OBJECT_FIELDS = 1_000;
const MAX_WIRE_STRING_LENGTH = 256 * 1024;
const MAX_WIRE_TOTAL_STRING_LENGTH = 1024 * 1024;

interface SnapshotBudget {
  nodes: number;
  stringLength: number;
}

function invalidWire(label: string, detail: string): never {
  throw REQUEST_ERROR.create({
    detail: `Invalid ${label} response: ${detail}`,
    status: 502,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDataProperty(
  record: object,
  key: string,
  label: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) invalidWire(label, `${key} must be a data property`);
  return descriptor.value;
}

function readRequiredString(
  record: object,
  key: string,
  label: string,
): string {
  const value = readDataProperty(record, key, label);
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_WIRE_STRING_LENGTH) {
    invalidWire(label, `${key} must be a bounded non-empty string`);
  }
  return value;
}

function readOptionalString(
  record: object,
  key: string,
  label: string,
): string | undefined {
  const value = readDataProperty(record, key, label);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > MAX_WIRE_STRING_LENGTH) {
    invalidWire(label, `${key} must be a bounded string when present`);
  }
  return value;
}

function readDate(record: object, key: string, label: string, optional: false): Date;
function readDate(record: object, key: string, label: string, optional: true): Date | undefined;
function readDate(
  record: object,
  key: string,
  label: string,
  optional: boolean,
): Date | undefined {
  const value = readDataProperty(record, key, label);
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length > 64) {
    invalidWire(label, `${key} must be an ISO date string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    invalidWire(label, `${key} must be a canonical ISO date string`);
  }
  return date;
}

function snapshotJsonValue(
  value: unknown,
  budget: SnapshotBudget,
  label: string,
  depth = 0,
): unknown {
  budget.nodes -= 1;
  if (budget.nodes < 0) invalidWire(label, "payload exceeds the node limit");
  if (depth > MAX_WIRE_DEPTH) invalidWire(label, "payload exceeds the nesting limit");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidWire(label, "payload numbers must be finite");
    return value;
  }
  if (typeof value === "string") {
    budget.stringLength += value.length;
    if (
      value.length > MAX_WIRE_STRING_LENGTH ||
      budget.stringLength > MAX_WIRE_TOTAL_STRING_LENGTH
    ) {
      invalidWire(label, "payload strings exceed protocol limits");
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_WIRE_COLLECTION_ITEMS) {
      invalidWire(label, "payload array exceeds the item limit");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length !== value.length + 1) {
      invalidWire(label, "payload arrays must be dense JSON arrays");
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        invalidWire(label, "payload arrays must contain data properties");
      }
      snapshot.push(snapshotJsonValue(descriptor.value, budget, label, depth + 1));
    }
    return snapshot;
  }

  if (!isRecord(value)) invalidWire(label, "payload must contain only JSON values");
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > MAX_WIRE_OBJECT_FIELDS ||
    ownKeys.some((key) => typeof key !== "string")
  ) {
    invalidWire(label, "payload object exceeds protocol limits");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string") invalidWire(label, "payload keys must be strings");
    if (key.length > MAX_WIRE_STRING_LENGTH) {
      invalidWire(label, "payload key exceeds the string limit");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      invalidWire(label, "payload fields must be data properties");
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotJsonValue(descriptor.value, budget, label, depth + 1),
      writable: true,
    });
  }
  return snapshot;
}

/** Capture a bounded, accessor-free JSON value without dropping nested user data. */
export function snapshotWorkflowJson(value: unknown, label: string): unknown {
  return snapshotJsonValue(
    value,
    { nodes: MAX_WIRE_NODES, stringLength: 0 },
    label,
  );
}

function readApprovers(
  record: object,
  label: string,
): string[] | undefined {
  const value = readDataProperty(record, "approvers", label);
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > MAX_WIRE_COLLECTION_ITEMS
  ) {
    invalidWire(label, "approvers must be a bounded non-empty array");
  }
  const seen = new Set<string>();
  const approvers: string[] = [];
  for (const approver of value) {
    if (
      typeof approver !== "string" || approver.length === 0 ||
      approver.length > MAX_WIRE_STRING_LENGTH || approver.trim() !== approver ||
      seen.has(approver)
    ) {
      invalidWire(label, "approvers must contain unique canonical strings");
    }
    seen.add(approver);
    approvers.push(approver);
  }
  return approvers;
}

/** Validate and snapshot a pending-approval endpoint response. */
export function parsePendingApprovalResponse(value: unknown): PendingApproval {
  const label = "workflow approval";
  const captured = snapshotWorkflowJson(value, label);
  if (!isRecord(captured)) invalidWire(label, "expected an object");

  const id = readRequiredString(captured, "id", label);
  const nodeId = readRequiredString(captured, "nodeId", label);
  const message = readRequiredString(captured, "message", label);
  const payload = readDataProperty(captured, "payload", label);
  if (payload === undefined) invalidWire(label, "payload is required");
  const approvers = readApprovers(captured, label);
  const requestedAt = readDate(captured, "requestedAt", label, false);
  const expiresAt = readDate(captured, "expiresAt", label, true);
  const status = readDataProperty(captured, "status", label);
  if (
    status !== "pending" && status !== "approved" && status !== "rejected" &&
    status !== "expired"
  ) {
    invalidWire(label, "status is invalid");
  }
  const decidedBy = readOptionalString(captured, "decidedBy", label);
  const decidedAt = readDate(captured, "decidedAt", label, true);
  const comment = readOptionalString(captured, "comment", label);
  const notificationError = readOptionalString(captured, "notificationError", label);

  return {
    id,
    nodeId,
    message,
    payload,
    ...(approvers === undefined ? {} : { approvers }),
    requestedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    status,
    ...(decidedBy === undefined ? {} : { decidedBy }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
    ...(comment === undefined ? {} : { comment }),
    ...(notificationError === undefined ? {} : { notificationError }),
  };
}

/** Validate the workflow-start response while preserving the legacy `id` alias. */
export function parseWorkflowStartResponse(value: unknown): string {
  const label = "workflow start";
  const captured = snapshotWorkflowJson(value, label);
  if (!isRecord(captured)) invalidWire(label, "expected an object");
  const runIdValue = readDataProperty(captured, "runId", label);
  const idValue = readDataProperty(captured, "id", label);
  const selected = runIdValue ?? idValue;
  if (
    typeof selected !== "string" || selected.length === 0 ||
    selected.length > MAX_WIRE_STRING_LENGTH
  ) {
    invalidWire(label, "runId or id must be a bounded non-empty string");
  }
  if (
    runIdValue !== undefined &&
    (typeof runIdValue !== "string" || runIdValue.length === 0 ||
      runIdValue.length > MAX_WIRE_STRING_LENGTH)
  ) {
    invalidWire(label, "runId must be a bounded non-empty string when present");
  }
  if (
    idValue !== undefined &&
    (typeof idValue !== "string" || idValue.length === 0 ||
      idValue.length > MAX_WIRE_STRING_LENGTH)
  ) {
    invalidWire(label, "id must be a bounded non-empty string when present");
  }
  return selected;
}

function readWorkflowStatus(record: object, key: string, label: string): WorkflowStatus {
  const value = readDataProperty(record, key, label);
  if (
    value !== "pending" && value !== "running" && value !== "waiting" &&
    value !== "completed" && value !== "failed" && value !== "cancelled"
  ) {
    invalidWire(label, `${key} is invalid`);
  }
  return value;
}

function readStringArray(record: object, key: string, label: string): string[] {
  const value = readDataProperty(record, key, label);
  if (!Array.isArray(value) || value.length > MAX_WIRE_COLLECTION_ITEMS) {
    invalidWire(label, `${key} must be a bounded array`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" || entry.length === 0 ||
      entry.length > MAX_WIRE_STRING_LENGTH
    ) {
      invalidWire(label, `${key} must contain bounded non-empty strings`);
    }
    result.push(entry);
  }
  return result;
}

function readNodeState(value: unknown, label: string): NodeState {
  if (!isRecord(value)) invalidWire(label, "node state must be an object");
  const nodeId = readRequiredString(value, "nodeId", label);
  const status = readDataProperty(value, "status", label);
  if (
    status !== "pending" && status !== "running" && status !== "completed" &&
    status !== "failed" && status !== "skipped"
  ) {
    invalidWire(label, "node status is invalid");
  }
  const attempt = readDataProperty(value, "attempt", label);
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0) {
    invalidWire(label, "node attempt must be a non-negative safe integer");
  }
  const input = readDataProperty(value, "input", label);
  const output = readDataProperty(value, "output", label);
  const error = readOptionalString(value, "error", label);
  const startedAt = readDate(value, "startedAt", label, true);
  const completedAt = readDate(value, "completedAt", label, true);
  return {
    nodeId,
    status,
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    attempt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function readNodeStates(value: unknown, label: string): Record<string, NodeState> {
  if (!isRecord(value)) invalidWire(label, "nodeStates must be an object");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > MAX_WIRE_OBJECT_FIELDS ||
    keys.some((key) => typeof key !== "string")
  ) {
    invalidWire(label, "nodeStates exceeds protocol limits");
  }
  const states: Record<string, NodeState> = {};
  for (const key of keys) {
    if (typeof key !== "string") invalidWire(label, "node state keys must be strings");
    const entry = readDataProperty(value, key, label);
    Object.defineProperty(states, key, {
      configurable: true,
      enumerable: true,
      value: readNodeState(entry, label),
      writable: true,
    });
  }
  return states;
}

function readWorkflowContext(value: unknown, label: string): WorkflowContext {
  if (!isRecord(value)) invalidWire(label, "context must be an object");
  const input = readDataProperty(value, "input", label);
  if (input === undefined) invalidWire(label, "context.input is required");
  const context: WorkflowContext = { input };
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalidWire(label, "context keys must be strings");
    if (key === "input") continue;
    if (key === "env" || key === "_tenant") {
      invalidWire(label, "context contains internal execution metadata");
    }
    Object.defineProperty(context, key, {
      configurable: true,
      enumerable: true,
      value: readDataProperty(value, key, label),
      writable: true,
    });
  }
  return context;
}

function readCheckpoints(value: unknown, label: string): Checkpoint[] {
  if (!Array.isArray(value) || value.length > MAX_WIRE_COLLECTION_ITEMS) {
    invalidWire(label, "checkpoints must be a bounded array");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) invalidWire(label, "checkpoint must be an object");
    return {
      id: readRequiredString(entry, "id", label),
      nodeId: readRequiredString(entry, "nodeId", label),
      timestamp: readDate(entry, "timestamp", label, false),
      context: readWorkflowContext(readDataProperty(entry, "context", label), label),
      nodeStates: readNodeStates(readDataProperty(entry, "nodeStates", label), label),
    };
  });
}

function readPendingApprovals(value: unknown, label: string): PendingApproval[] {
  if (!Array.isArray(value) || value.length > MAX_WIRE_COLLECTION_ITEMS) {
    invalidWire(label, "pendingApprovals must be a bounded array");
  }
  return value.map((entry) => parsePendingApprovalResponse(entry));
}

function readWorkflowError(value: unknown, label: string): WorkflowError | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalidWire(label, "error must be an object when present");
  const message = readRequiredString(value, "message", label);
  const stack = readOptionalString(value, "stack", label);
  const nodeId = readOptionalString(value, "nodeId", label);
  return {
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(nodeId === undefined ? {} : { nodeId }),
  };
}

function readSourceIntegrationPolicy(
  value: unknown,
  label: string,
): SourceIntegrationPolicyManifest {
  try {
    return parseSourceIntegrationPolicyManifest(value);
  } catch {
    invalidWire(label, "sourceIntegrationPolicy is invalid");
  }
}

/** Validate, snapshot, and revive the documented dates in a workflow run. */
export function parseWorkflowRunResponse(value: unknown): WorkflowRun {
  const label = "workflow run";
  const captured = snapshotWorkflowJson(value, label);
  if (!isRecord(captured)) invalidWire(label, "expected an object");
  if (Object.hasOwn(captured, "_tenant") || Object.hasOwn(captured, "_runtimeStateVersion")) {
    invalidWire(label, "response contains internal execution metadata");
  }

  const id = readRequiredString(captured, "id", label);
  const workflowId = readRequiredString(captured, "workflowId", label);
  const version = readOptionalString(captured, "version", label);
  const status = readWorkflowStatus(captured, "status", label);
  const input = readDataProperty(captured, "input", label);
  if (input === undefined) invalidWire(label, "input is required");
  const output = readDataProperty(captured, "output", label);
  const nodeStates = readNodeStates(readDataProperty(captured, "nodeStates", label), label);
  const currentNodes = readStringArray(captured, "currentNodes", label);
  const context = readWorkflowContext(readDataProperty(captured, "context", label), label);
  const checkpoints = readCheckpoints(readDataProperty(captured, "checkpoints", label), label);
  const pendingApprovals = readPendingApprovals(
    readDataProperty(captured, "pendingApprovals", label),
    label,
  );
  const workflowError = readWorkflowError(readDataProperty(captured, "error", label), label);
  const createdAt = readDate(captured, "createdAt", label, false);
  const startedAt = readDate(captured, "startedAt", label, true);
  const heartbeatAt = readDate(captured, "heartbeatAt", label, true);
  const completedAt = readDate(captured, "completedAt", label, true);
  const sourceIntegrationPolicy = readSourceIntegrationPolicy(
    readDataProperty(captured, "sourceIntegrationPolicy", label),
    label,
  );
  const workerId = readOptionalString(captured, "workerId", label);

  return {
    id,
    workflowId,
    ...(version === undefined ? {} : { version }),
    status,
    input,
    ...(output === undefined ? {} : { output }),
    nodeStates,
    currentNodes,
    context,
    checkpoints,
    pendingApprovals,
    ...(workflowError === undefined ? {} : { error: workflowError }),
    createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    sourceIntegrationPolicy,
    ...(workerId === undefined ? {} : { workerId }),
  };
}

/** Read a bounded optional server message without trusting a failed response body. */
export async function readWorkflowErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) return fallback;
    const message = readDataProperty(value, "message", "workflow error");
    return typeof message === "string" && message.length > 0 &&
        message.length <= MAX_WIRE_STRING_LENGTH
      ? message
      : fallback;
  } catch {
    return fallback;
  }
}
