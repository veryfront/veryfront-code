import { logger as baseLogger } from "#veryfront/utils";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type {
  Checkpoint,
  NodeState,
  WorkflowContext,
  WorkflowGraphAdmission,
  WorkflowNode,
} from "../types.ts";
import { generateId } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import {
  SUBWORKFLOW_INPUT_KIND,
  type WorkflowProjectionState,
  workflowRuntimeValuesEqual,
} from "../runtime-state.ts";
import {
  captureWorkflowStaticValue,
  cloneCapturedWorkflowStaticValue,
} from "./workflow-definition-snapshot.ts";
import { captureCanonicalWorkflowGraphIdentity } from "./dag/graph-identity.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";
import { markWorkflowVersionAdmissionError } from "./workflow-version-admission-error.ts";

const logger = baseLogger.component("checkpoint-manager");

export interface CheckpointManagerConfig {
  backend: WorkflowBackend;
  debug?: boolean;
}

export interface ResumeInfo {
  checkpoint: Checkpoint;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  workflowProjection?: WorkflowProjectionState;
  nodes: WorkflowNode[];
  graphAdmission?: WorkflowGraphAdmission;
}

export interface CheckpointRunRecoveryState {
  context: WorkflowContext;
  workflowProjection?: WorkflowProjectionState;
  /** Immutable workflow version persisted on the owning run. */
  workflowVersion?: string | null;
}

function recoveryFailure(detail: string, cause?: unknown): Error {
  return ORCHESTRATION_ERROR.create({
    detail: `Cannot safely resume workflow checkpoint: ${detail}`,
    ...(cause === undefined ? {} : { cause }),
  });
}

function workflowVersionRecoveryFailure(detail: string): Error {
  return markWorkflowVersionAdmissionError(recoveryFailure(detail));
}

function inspectPlainRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw recoveryFailure(`${label} must be a non-Proxy plain record`);
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch (cause) {
    throw recoveryFailure(`${label} could not be inspected`, cause);
  }
  if (prototype !== null) {
    if (isProxyWithoutHooks(prototype)) {
      throw recoveryFailure(`${label} must not inherit from a Proxy`);
    }
    let parent: object | null;
    try {
      parent = Object.getPrototypeOf(prototype) as object | null;
    } catch (cause) {
      throw recoveryFailure(`${label} prototype could not be inspected`, cause);
    }
    if (parent !== null) throw recoveryFailure(`${label} must be a plain record`);
  }
  return value as Record<PropertyKey, unknown>;
}

function readOwnData(
  record: Record<PropertyKey, unknown>,
  key: string,
  label: string,
  required = true,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch (cause) {
    throw recoveryFailure(`${label} field "${key}" could not be inspected`, cause);
  }
  if (!descriptor) {
    if (!required) return undefined;
    throw recoveryFailure(`${label} is missing own data field "${key}"`);
  }
  if (!("value" in descriptor)) {
    throw recoveryFailure(`${label} field "${key}" must be an own data property`);
  }
  return descriptor.value;
}

function captureDurableValue<T>(value: T, label: string): T {
  try {
    const captured = captureWorkflowStaticValue(value, label);
    return cloneCapturedWorkflowStaticValue(captured, label);
  } catch (cause) {
    throw recoveryFailure(`${label} is not valid durable data`, cause);
  }
}

function captureDurableRecord<T extends object>(value: unknown, label: string): T {
  inspectPlainRecord(value, label);
  return captureDurableValue(value, label) as T;
}

const NODE_STATUSES = new Set(["pending", "running", "completed", "failed", "skipped"]);
const intrinsicDateGetTime = Date.prototype.getTime;

function captureCheckpointDate(
  value: unknown,
  label: string,
  acceptString: boolean,
): Date {
  if (isProxyWithoutHooks(value)) {
    throw recoveryFailure(`${label} must not be a Proxy`);
  }
  const date = acceptString && typeof value === "string" ? new Date(value) : value;
  if (isProxyWithoutHooks(date) || typeof date !== "object" || date === null) {
    throw recoveryFailure(`${label} must be a valid Date`);
  }
  let timestamp: number;
  try {
    timestamp = Reflect.apply(intrinsicDateGetTime, date, []) as number;
  } catch (cause) {
    throw recoveryFailure(`${label} must be a valid Date`, cause);
  }
  if (!Number.isFinite(timestamp)) {
    throw recoveryFailure(`${label} must be a valid Date`);
  }
  return new Date(timestamp);
}

function normalizeNodeStateDate(
  state: Record<PropertyKey, unknown>,
  key: "startedAt" | "completedAt",
  label: string,
): void {
  const value = readOwnData(state, key, label, false);
  if (value === undefined) return;
  const date = captureCheckpointDate(value, `${label}.${key}`, true);
  Object.defineProperty(state, key, {
    value: date,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function captureNodeStates(
  value: unknown,
  label: string,
): Record<string, NodeState> {
  const states = captureDurableRecord<Record<string, NodeState>>(value, label);
  for (const [stateKey, candidate] of Object.entries(states)) {
    const state = inspectPlainRecord(candidate, `${label}.${stateKey}`);
    const nodeId = readOwnData(state, "nodeId", `${label}.${stateKey}`);
    const status = readOwnData(state, "status", `${label}.${stateKey}`);
    const attempt = readOwnData(state, "attempt", `${label}.${stateKey}`);
    const error = readOwnData(state, "error", `${label}.${stateKey}`, false);
    if (typeof nodeId !== "string" || nodeId !== stateKey) {
      throw recoveryFailure(`${label}.${stateKey}.nodeId must equal its record key`);
    }
    if (typeof status !== "string" || !NODE_STATUSES.has(status)) {
      throw recoveryFailure(`${label}.${stateKey}.status is invalid`);
    }
    if (!Number.isSafeInteger(attempt) || (attempt as number) < 0) {
      throw recoveryFailure(`${label}.${stateKey}.attempt must be a non-negative safe integer`);
    }
    if (status === "running" && (attempt as number) < 1) {
      throw recoveryFailure(`${label}.${stateKey}.running attempt must be at least 1`);
    }
    if (error !== undefined && typeof error !== "string") {
      throw recoveryFailure(`${label}.${stateKey}.error must be a string`);
    }
    normalizeNodeStateDate(state, "startedAt", `${label}.${stateKey}`);
    normalizeNodeStateDate(state, "completedAt", `${label}.${stateKey}`);
  }
  return states;
}

function captureProjection(value: unknown, label: string): WorkflowProjectionState {
  const record = inspectPlainRecord(value, label);
  const context = readOwnData(record, "context", label);
  inspectPlainRecord(context, `${label}.context`);
  const inputKind = readOwnData(record, "inputKind", label, false);
  if (inputKind !== undefined && inputKind !== SUBWORKFLOW_INPUT_KIND) {
    throw recoveryFailure(`${label}.inputKind is invalid`);
  }
  return captureDurableValue(value, label) as WorkflowProjectionState;
}

function captureGraphAdmission(value: unknown): WorkflowGraphAdmission {
  const label = "checkpoint graph admission";
  const record = inspectPlainRecord(value, label);
  const stepsEvaluationContext = readOwnData(record, "stepsEvaluationContext", label);
  const stepsEvaluationProjection = readOwnData(record, "stepsEvaluationProjection", label);
  const graphIdentity = readOwnData(record, "graphIdentity", label);
  const workflowVersion = readOwnData(record, "workflowVersion", label);
  if (workflowVersion !== null && typeof workflowVersion !== "string") {
    throw recoveryFailure(`${label}.workflowVersion must be a string or null`);
  }
  if (!Array.isArray(graphIdentity)) {
    throw recoveryFailure(`${label}.graphIdentity must be an array`);
  }
  return {
    stepsEvaluationContext: captureDurableRecord<WorkflowContext>(
      stepsEvaluationContext,
      `${label}.stepsEvaluationContext`,
    ),
    stepsEvaluationProjection: captureProjection(
      stepsEvaluationProjection,
      `${label}.stepsEvaluationProjection`,
    ),
    graphIdentity: captureDurableValue(graphIdentity, `${label}.graphIdentity`),
    workflowVersion,
  };
}

function captureLegacyGraphAdmission(
  nodesOrResolver: WorkflowNode[] | ((context: WorkflowContext) => WorkflowNode[]),
  evaluationContext: WorkflowContext,
  evaluationProjection: WorkflowProjectionState,
  workflowVersion: string | null | undefined,
): { nodes: WorkflowNode[]; graphAdmission: WorkflowGraphAdmission } {
  const stepsEvaluationContext = captureDurableRecord<WorkflowContext>(
    evaluationContext,
    "legacy workflow steps evaluation context",
  );
  const stepsEvaluationProjection = captureProjection(
    evaluationProjection,
    "legacy workflow steps evaluation projection",
  );
  let nodes: WorkflowNode[];
  try {
    nodes = typeof nodesOrResolver === "function"
      ? nodesOrResolver(cloneCapturedWorkflowStaticValue(
        stepsEvaluationContext,
        "Legacy workflow steps callback context",
      ))
      : nodesOrResolver;
  } catch (cause) {
    throw recoveryFailure("legacy workflow graph builder failed", cause);
  }
  return {
    nodes,
    graphAdmission: {
      stepsEvaluationContext,
      stepsEvaluationProjection,
      graphIdentity: captureCanonicalWorkflowGraphIdentity(nodes),
      workflowVersion: workflowVersion ?? null,
    },
  };
}

function requireLegacyWorkflowVersionProof(
  expectedWorkflowVersion: string | null | undefined,
  recoveryState: CheckpointRunRecoveryState | undefined,
  label: string,
): CheckpointRunRecoveryState & { workflowVersion: string } {
  const storedWorkflowVersion = recoveryState?.workflowVersion;
  if (
    expectedWorkflowVersion === undefined || expectedWorkflowVersion === null ||
    storedWorkflowVersion === undefined || storedWorkflowVersion === null
  ) {
    throw workflowVersionRecoveryFailure(
      `${label} has no complete durable workflow-version proof; migration is required`,
    );
  }
  if (storedWorkflowVersion !== expectedWorkflowVersion) {
    throw workflowVersionRecoveryFailure(
      `stored workflow version "${storedWorkflowVersion}" does not match current version ` +
        `"${expectedWorkflowVersion}"`,
    );
  }
  return recoveryState as CheckpointRunRecoveryState & { workflowVersion: string };
}

function captureResumeEnvelopeSnapshot(value: unknown, label: string): Record<string, unknown> {
  const record = inspectPlainRecord(value, label);
  const schemaVersion = readOwnData(record, "schemaVersion", label);
  if (schemaVersion === 1) {
    const startFromNode = readOwnData(record, "startFromNode", label);
    if (typeof startFromNode !== "string" || startFromNode.length === 0) {
      throw recoveryFailure(`${label}.startFromNode must be a non-empty string`);
    }
    return {
      schemaVersion: 1,
      startFromNode,
      context: captureDurableRecord<WorkflowContext>(
        readOwnData(record, "context", label),
        `${label}.context`,
      ),
      nodeStates: captureNodeStates(
        readOwnData(record, "nodeStates", label),
        `${label}.nodeStates`,
      ),
      workflowProjection: captureProjection(
        readOwnData(record, "workflowProjection", label),
        `${label}.workflowProjection`,
      ),
    };
  }
  if (schemaVersion === 2) {
    const ownerNodeId = readOwnData(record, "ownerNodeId", label);
    if (typeof ownerNodeId !== "string" || ownerNodeId.length === 0) {
      throw recoveryFailure(`${label}.ownerNodeId must be a non-empty string`);
    }
    return {
      schemaVersion: 2,
      ownerNodeId,
      context: captureDurableRecord<WorkflowContext>(
        readOwnData(record, "context", label),
        `${label}.context`,
      ),
      nodeStates: captureNodeStates(
        readOwnData(record, "nodeStates", label),
        `${label}.nodeStates`,
      ),
      workflowProjection: captureProjection(
        readOwnData(record, "workflowProjection", label),
        `${label}.workflowProjection`,
      ),
      graphAdmission: captureGraphAdmission(
        readOwnData(record, "graphAdmission", label),
      ),
    };
  }
  throw recoveryFailure(`${label} has unsupported schema ${String(schemaVersion)}`);
}

function captureCheckpointSnapshot(value: unknown, label = "checkpoint"): Checkpoint {
  const record = inspectPlainRecord(value, label);
  const id = readOwnData(record, "id", label);
  const nodeId = readOwnData(record, "nodeId", label);
  if (typeof id !== "string" || id.length === 0) {
    throw recoveryFailure(`${label} id must be a non-empty string`);
  }
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw recoveryFailure(`${label} nodeId must be a non-empty string`);
  }
  const timestamp = captureCheckpointDate(
    readOwnData(record, "timestamp", label),
    `${label}.timestamp`,
    false,
  );
  const context = captureDurableRecord<WorkflowContext>(
    readOwnData(record, "context", label),
    `${label}.context`,
  );
  const nodeStates = captureNodeStates(
    readOwnData(record, "nodeStates", label),
    `${label}.nodeStates`,
  );
  const rawProjection = readOwnData(record, "_workflowProjection", label, false);
  const workflowProjection = rawProjection === undefined
    ? undefined
    : captureProjection(rawProjection, `${label}._workflowProjection`);
  const rawEnvelope = readOwnData(record, "_resumeEnvelope", label, false);
  const resumeEnvelope = rawEnvelope === undefined
    ? undefined
    : captureResumeEnvelopeSnapshot(rawEnvelope, `${label}._resumeEnvelope`);

  return {
    id,
    nodeId,
    timestamp,
    context,
    nodeStates,
    ...(workflowProjection === undefined ? {} : { _workflowProjection: workflowProjection }),
    ...(resumeEnvelope === undefined
      ? {}
      // The public Checkpoint type models only newly-written schema-2
      // envelopes; schema-1 is retained here solely for compatibility decode.
      : {
        _resumeEnvelope: resumeEnvelope as unknown as NonNullable<Checkpoint["_resumeEnvelope"]>,
      }),
  };
}

function captureCheckpointHistory(value: unknown): Checkpoint[] {
  const label = "checkpoint history";
  if (isProxyWithoutHooks(value) || !Array.isArray(value)) {
    throw recoveryFailure(`${label} must be a non-Proxy dense array`);
  }

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch (cause) {
    throw recoveryFailure(`${label} length could not be inspected`, cause);
  }
  if (
    !lengthDescriptor || !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
  ) {
    throw recoveryFailure(`${label} length must be an own non-negative safe integer`);
  }
  const length = lengthDescriptor.value as number;
  if (length > MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES) {
    throw recoveryFailure(
      `${label} must contain at most ${MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES} entries`,
    );
  }

  let ownKeys: PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch (cause) {
    throw recoveryFailure(`${label} own keys could not be inspected`, cause);
  }
  const expectedKeys = new Set<PropertyKey>([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw recoveryFailure(`${label} must contain exactly its dense entries and length`);
  }

  const history = new Array<Checkpoint>(length);
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch (cause) {
      throw recoveryFailure(`${label}[${index}] could not be inspected`, cause);
    }
    if (!descriptor) {
      throw recoveryFailure(`${label} must be dense; entry ${index} is missing`);
    }
    if (!("value" in descriptor)) {
      throw recoveryFailure(`${label}[${index}] must be an own data property`);
    }
    history[index] = captureCheckpointSnapshot(
      descriptor.value,
      `${label}[${index}]`,
    );
  }
  return history;
}

/** Canonical run identity used to fence auxiliary writes from stale workers. */
export interface CheckpointOwnership {
  runId: string;
  workerId: string;
}

export class CheckpointManager {
  private config: CheckpointManagerConfig;

  constructor(config: CheckpointManagerConfig) {
    this.config = { debug: false, ...config };
  }

  async save(
    runId: string,
    checkpoint: Checkpoint,
    ownership?: CheckpointOwnership,
  ): Promise<boolean> {
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });

    if (ownership) {
      const saveOwned = this.config.backend.saveCheckpointIfStatusAndWorker;
      if (!saveOwned) return false;
      return await saveOwned.call(
        this.config.backend,
        runId,
        ownership.runId,
        ["running"],
        ownership.workerId,
        checkpoint,
      );
    }

    await this.config.backend.saveCheckpoint(runId, checkpoint);
    return true;
  }

  async createCheckpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    workflowProjection?: WorkflowProjectionState,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: generateId("cp"),
      nodeId,
      timestamp: new Date(),
      context: structuredClone(context),
      nodeStates: structuredClone(nodeStates),
      ...(workflowProjection === undefined
        ? {}
        : { _workflowProjection: structuredClone(workflowProjection) }),
    };

    await this.save(runId, checkpoint);
    return checkpoint;
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const checkpoint = await this.config.backend.getLatestCheckpoint(runId);
    return checkpoint === null ? null : captureCheckpointSnapshot(checkpoint);
  }

  async getAll(runId: string): Promise<Checkpoint[]> {
    const { getCheckpoints } = this.config.backend;
    if (getCheckpoints) {
      return captureCheckpointHistory(await getCheckpoints.call(this.config.backend, runId));
    }

    const latest = await this.getLatest(runId);
    return captureCheckpointHistory(latest ? [latest] : []);
  }

  async prepareResume(
    runId: string,
    nodesOrResolver: WorkflowNode[] | ((context: WorkflowContext) => WorkflowNode[]),
    fromCheckpoint?: string,
    expectedWorkflowVersion?: string | null,
    recoveryState?: CheckpointRunRecoveryState,
  ): Promise<ResumeInfo | null> {
    let checkpoint: Checkpoint | null;
    if (fromCheckpoint) {
      checkpoint = null;
      for (const candidate of await this.getAll(runId)) {
        const record = inspectPlainRecord(candidate, "checkpoint");
        const candidateId = readOwnData(record, "id", "checkpoint");
        if (typeof candidateId !== "string") {
          throw recoveryFailure("checkpoint id must be a string");
        }
        if (candidateId === fromCheckpoint) {
          if (checkpoint !== null) {
            throw recoveryFailure("requested checkpoint id is ambiguous within run history");
          }
          checkpoint = candidate;
        }
      }
    } else {
      checkpoint = await this.getLatest(runId);
    }

    if (!checkpoint) return null;

    // Decode every backend-owned field before invoking a dynamic workflow
    // builder. A corrupt/accessor-bearing snapshot must fail closed without
    // letting user code observe it or silently falling back to root replay.
    const checkpointRecord = inspectPlainRecord(checkpoint, "checkpoint");
    const checkpointId = readOwnData(checkpointRecord, "id", "checkpoint");
    const checkpointNodeId = readOwnData(checkpointRecord, "nodeId", "checkpoint");
    const checkpointTimestamp = readOwnData(checkpointRecord, "timestamp", "checkpoint");
    if (typeof checkpointId !== "string" || typeof checkpointNodeId !== "string") {
      throw recoveryFailure("checkpoint id and nodeId must be strings");
    }
    const safeCheckpointTimestamp = captureCheckpointDate(
      checkpointTimestamp,
      "checkpoint.timestamp",
      false,
    );
    const checkpointContext = captureDurableRecord<WorkflowContext>(
      readOwnData(checkpointRecord, "context", "checkpoint"),
      "checkpoint.context",
    );
    const checkpointNodeStates = captureNodeStates(
      readOwnData(checkpointRecord, "nodeStates", "checkpoint"),
      "checkpoint.nodeStates",
    );
    const rawCheckpointProjection = readOwnData(
      checkpointRecord,
      "_workflowProjection",
      "checkpoint",
      false,
    );
    const checkpointProjection = rawCheckpointProjection === undefined
      ? undefined
      : captureProjection(rawCheckpointProjection, "checkpoint._workflowProjection");
    const rawEnvelope = readOwnData(checkpointRecord, "_resumeEnvelope", "checkpoint", false);
    const safeCheckpoint: Checkpoint = {
      id: checkpointId,
      nodeId: checkpointNodeId,
      timestamp: safeCheckpointTimestamp,
      context: checkpointContext,
      nodeStates: checkpointNodeStates,
      ...(checkpointProjection === undefined ? {} : { _workflowProjection: checkpointProjection }),
    };

    if (rawEnvelope === undefined) {
      const provenRecoveryState = requireLegacyWorkflowVersionProof(
        expectedWorkflowVersion,
        recoveryState,
        "legacy checkpoint",
      );
      if (typeof nodesOrResolver === "function") {
        throw recoveryFailure(
          "legacy dynamic workflow checkpoint has no original graph-admission snapshot; migration is required",
        );
      }
      if (!nodesOrResolver.some((node) => node.id === checkpointNodeId)) {
        throw recoveryFailure(
          "legacy descendant checkpoint has no owning root envelope; migration is required",
        );
      }
      const legacyAdmission = captureLegacyGraphAdmission(
        nodesOrResolver,
        provenRecoveryState.context,
        provenRecoveryState.workflowProjection ?? checkpointProjection ?? { context: {} },
        provenRecoveryState.workflowVersion,
      );
      return {
        checkpoint: safeCheckpoint,
        context: checkpointContext,
        nodeStates: checkpointNodeStates,
        ...(checkpointProjection === undefined ? {} : { workflowProjection: checkpointProjection }),
        ...legacyAdmission,
      };
    }

    const envelopeRecord = inspectPlainRecord(rawEnvelope, "checkpoint resume envelope");
    const schemaVersion = readOwnData(
      envelopeRecord,
      "schemaVersion",
      "checkpoint resume envelope",
    );

    // Schema 1 had enough information for static definitions only. Dynamic
    // definitions cannot reconstruct their original evaluation context and
    // must stop instead of deriving a graph from post-node checkpoint state.
    if (schemaVersion === 1) {
      const ownerNodeId = readOwnData(
        envelopeRecord,
        "startFromNode",
        "legacy checkpoint resume envelope",
      );
      const context = captureDurableRecord<WorkflowContext>(
        readOwnData(envelopeRecord, "context", "legacy checkpoint resume envelope"),
        "legacy checkpoint resume envelope.context",
      );
      const nodeStates = captureNodeStates(
        readOwnData(envelopeRecord, "nodeStates", "legacy checkpoint resume envelope"),
        "legacy checkpoint resume envelope.nodeStates",
      );
      const workflowProjection = captureProjection(
        readOwnData(
          envelopeRecord,
          "workflowProjection",
          "legacy checkpoint resume envelope",
        ),
        "legacy checkpoint resume envelope.workflowProjection",
      );
      if (typeof ownerNodeId !== "string" || ownerNodeId.length === 0) {
        throw recoveryFailure("legacy checkpoint owner must be a non-empty string");
      }
      const provenRecoveryState = requireLegacyWorkflowVersionProof(
        expectedWorkflowVersion,
        recoveryState,
        "legacy schema-1 resume envelope",
      );
      if (typeof nodesOrResolver === "function") {
        throw recoveryFailure(
          "legacy dynamic workflow envelope has no original graph identity; migration is required",
        );
      }
      if (!nodesOrResolver.some((node) => node.id === ownerNodeId)) {
        throw recoveryFailure("legacy checkpoint owner is not present in the current root graph");
      }
      const legacyAdmission = captureLegacyGraphAdmission(
        nodesOrResolver,
        provenRecoveryState.context,
        provenRecoveryState.workflowProjection ?? workflowProjection,
        provenRecoveryState.workflowVersion,
      );
      return {
        checkpoint: safeCheckpoint,
        context,
        nodeStates,
        workflowProjection,
        ...legacyAdmission,
      };
    }

    if (schemaVersion !== 2) {
      throw recoveryFailure(`unsupported resume envelope schema ${String(schemaVersion)}`);
    }
    const ownerNodeId = readOwnData(
      envelopeRecord,
      "ownerNodeId",
      "checkpoint resume envelope",
    );
    if (typeof ownerNodeId !== "string" || ownerNodeId.length === 0) {
      throw recoveryFailure("checkpoint resume envelope ownerNodeId must be a non-empty string");
    }
    const context = captureDurableRecord<WorkflowContext>(
      readOwnData(envelopeRecord, "context", "checkpoint resume envelope"),
      "checkpoint resume envelope.context",
    );
    const nodeStates = captureNodeStates(
      readOwnData(envelopeRecord, "nodeStates", "checkpoint resume envelope"),
      "checkpoint resume envelope.nodeStates",
    );
    const workflowProjection = captureProjection(
      readOwnData(envelopeRecord, "workflowProjection", "checkpoint resume envelope"),
      "checkpoint resume envelope.workflowProjection",
    );
    const graphAdmission = captureGraphAdmission(
      readOwnData(envelopeRecord, "graphAdmission", "checkpoint resume envelope"),
    );
    const storedWorkflowVersion = recoveryState?.workflowVersion;
    if (
      expectedWorkflowVersion === undefined || expectedWorkflowVersion === null ||
      storedWorkflowVersion === undefined || storedWorkflowVersion === null ||
      graphAdmission.workflowVersion === null
    ) {
      throw workflowVersionRecoveryFailure(
        "schema-2 checkpoint recovery requires non-null durable workflow versions on the " +
          "stored run, checkpoint admission, and current definition; migration is required",
      );
    }
    if (
      storedWorkflowVersion !== expectedWorkflowVersion ||
      graphAdmission.workflowVersion !== expectedWorkflowVersion
    ) {
      throw workflowVersionRecoveryFailure(
        `checkpoint workflow version "${graphAdmission.workflowVersion}" and stored run version ` +
          `"${storedWorkflowVersion}" must both match current version ` +
          `"${expectedWorkflowVersion}"`,
      );
    }

    let nodes: WorkflowNode[];
    try {
      nodes = typeof nodesOrResolver === "function"
        ? nodesOrResolver(cloneCapturedWorkflowStaticValue(
          graphAdmission.stepsEvaluationContext,
          "Workflow checkpoint steps evaluation context",
        ))
        : nodesOrResolver;
    } catch (cause) {
      throw recoveryFailure(
        "workflow graph builder failed for the persisted admission snapshot",
        cause,
      );
    }
    const currentGraphIdentity = captureCanonicalWorkflowGraphIdentity(nodes);
    if (!workflowRuntimeValuesEqual(currentGraphIdentity, graphAdmission.graphIdentity)) {
      throw recoveryFailure("current workflow graph differs from the persisted admitted graph");
    }
    if (!nodes.some((node) => node.id === ownerNodeId)) {
      throw recoveryFailure("checkpoint owner is not present in the admitted root graph");
    }

    safeCheckpoint._resumeEnvelope = {
      schemaVersion: 2,
      ownerNodeId,
      context,
      nodeStates,
      workflowProjection,
      graphAdmission,
    };
    return {
      checkpoint: safeCheckpoint,
      context,
      nodeStates,
      workflowProjection,
      nodes,
      graphAdmission,
    };
  }

  shouldCheckpoint(node: WorkflowNode): boolean {
    const { config } = node;

    if (config.checkpoint !== undefined) return config.checkpoint;

    if (config.type === "step") {
      return "agent" in config && !!config.agent;
    }

    const checkpointDefaults: Record<string, boolean> = {
      wait: true,
      parallel: true,
      subWorkflow: true,
      branch: false,
    };

    return checkpointDefaults[config.type] ?? false;
  }

  async cleanup(runId: string, keepCount: number = 5): Promise<void> {
    if (!Number.isSafeInteger(keepCount) || keepCount < 0) {
      throw new RangeError("Checkpoint keepCount must be a non-negative safe integer");
    }

    const all = await this.getAll(runId);
    if (all.length <= keepCount) return;

    // getCheckpoints is append-ordered oldest-to-newest. Retention follows
    // that durable order and never trusts backend-owned timestamps for recency.
    const idsToDelete = all.slice(0, all.length - keepCount).map((c) => c.id);
    if (idsToDelete.length === 0) return;

    logger.debug("Cleaning up old checkpoints", {
      count: idsToDelete.length,
      runId,
    });

    const { backend } = this.config;

    if (backend.deleteCheckpoints) {
      await backend.deleteCheckpoints(runId, idsToDelete);
      return;
    }

    if (!backend.deleteCheckpoint) return;

    for (const id of idsToDelete) {
      await backend.deleteCheckpoint(runId, id);
    }
  }
}
