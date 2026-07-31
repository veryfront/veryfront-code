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

function recoveryFailure(detail: string, cause?: unknown): Error {
  return ORCHESTRATION_ERROR.create({
    detail: `Cannot safely resume workflow checkpoint: ${detail}`,
    ...(cause === undefined ? {} : { cause }),
  });
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

function normalizeNodeStateDate(
  state: Record<PropertyKey, unknown>,
  key: "startedAt" | "completedAt",
  label: string,
): void {
  const value = readOwnData(state, key, label, false);
  if (value === undefined) return;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw recoveryFailure(`${label}.${key} must be a valid Date`);
  }
  Object.defineProperty(state, key, {
    value: new Date(date.getTime()),
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

  getLatest(runId: string): Promise<Checkpoint | null> {
    return this.config.backend.getLatestCheckpoint(runId);
  }

  async getAll(runId: string): Promise<Checkpoint[]> {
    const { getCheckpoints } = this.config.backend;
    if (getCheckpoints) return getCheckpoints.call(this.config.backend, runId);

    const latest = await this.getLatest(runId);
    return latest ? [latest] : [];
  }

  async prepareResume(
    runId: string,
    nodesOrResolver: WorkflowNode[] | ((context: WorkflowContext) => WorkflowNode[]),
    fromCheckpoint?: string,
    expectedWorkflowVersion?: string | null,
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
          checkpoint = candidate;
          break;
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
    if (!(checkpointTimestamp instanceof Date) || !Number.isFinite(checkpointTimestamp.getTime())) {
      throw recoveryFailure("checkpoint timestamp must be a valid Date");
    }
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
      timestamp: new Date(checkpointTimestamp.getTime()),
      context: checkpointContext,
      nodeStates: checkpointNodeStates,
      ...(checkpointProjection === undefined ? {} : { _workflowProjection: checkpointProjection }),
    };

    if (rawEnvelope === undefined) {
      if (expectedWorkflowVersion === undefined || expectedWorkflowVersion === null) {
        throw recoveryFailure(
          "legacy checkpoint has no graph identity and its unversioned definition cannot be proven unchanged; migration is required",
        );
      }
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
      return {
        checkpoint: safeCheckpoint,
        context: checkpointContext,
        nodeStates: checkpointNodeStates,
        ...(checkpointProjection === undefined ? {} : { workflowProjection: checkpointProjection }),
        nodes: nodesOrResolver,
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
      if (expectedWorkflowVersion === undefined || expectedWorkflowVersion === null) {
        throw recoveryFailure(
          "legacy resume envelope has no graph identity and its unversioned definition cannot be proven unchanged; migration is required",
        );
      }
      if (typeof nodesOrResolver === "function") {
        throw recoveryFailure(
          "legacy dynamic workflow envelope has no original graph identity; migration is required",
        );
      }
      if (
        typeof ownerNodeId !== "string" ||
        !nodesOrResolver.some((node) => node.id === ownerNodeId)
      ) {
        throw recoveryFailure("legacy checkpoint owner is not present in the current root graph");
      }
      return {
        checkpoint: safeCheckpoint,
        context,
        nodeStates,
        workflowProjection,
        nodes: nodesOrResolver,
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
    if (
      expectedWorkflowVersion !== undefined &&
      graphAdmission.workflowVersion !== expectedWorkflowVersion
    ) {
      throw recoveryFailure(
        `checkpoint workflow version "${graphAdmission.workflowVersion ?? "unversioned"}" ` +
          `does not match current version "${expectedWorkflowVersion ?? "unversioned"}"`,
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
    const all = await this.getAll(runId);
    if (all.length <= keepCount) return;

    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const idsToDelete = all.slice(keepCount).map((c) => c.id);
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
