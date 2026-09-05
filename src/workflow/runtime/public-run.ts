import type { NodeState, WorkflowContext, WorkflowRun } from "../types.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import {
  captureWorkflowContextProjection,
  captureWorkflowProjectionPaths,
  FRAMEWORK_CONTEXT_PROJECTION_KIND,
  INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD,
  INTERNAL_MAP_CHILD_NODE_IDS_FIELD,
  INTERNAL_MAP_CONTEXT_FIELD,
  INTERNAL_MAP_CONTEXT_PROJECTION_FIELD,
  INTERNAL_MAP_ITEMS_FIELD,
  INTERNAL_RUNTIME_PROJECTION_KIND,
  INTERNAL_SUBWORKFLOW_STATE_FIELD,
  INTERNAL_WORKFLOW_INPUT_KIND_FIELD,
  INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD,
  INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD,
  INTERNAL_WORKFLOW_PROJECTION_STATE_FIELD,
  INTERNAL_WORKFLOW_RUNTIME_STATE_VERSION_FIELD,
  INTERNAL_WORKFLOW_TRACE_CONTEXT_FIELD,
  SUBWORKFLOW_CONTEXT_OUTPUT_KIND,
  SUBWORKFLOW_INPUT_KIND,
  WORKFLOW_RUNTIME_STATE_VERSION,
  type WorkflowContextProjection,
  type WorkflowProjectionPath,
  workflowRuntimeValuesEqual,
} from "../runtime-state.ts";
import { INTERNAL_WAIT_KIND_FIELD } from "../timed-wait-state.ts";

const INTERNAL_CONTEXT_KEYS = [
  "env",
  "_tenant",
  "_loop",
] as const;
const DEFAULT_OUTPUT_INTERNAL_KEYS = ["input", ...INTERNAL_CONTEXT_KEYS] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deleteOwnKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) Reflect.deleteProperty(value, key);
}

function getProjectionTarget(
  root: unknown,
  path: readonly (string | number)[],
): { parent: Record<PropertyKey, unknown> | unknown[]; key: string | number } | null {
  if (path.length === 0) return null;
  let current = root;
  for (let index = 0; index < path.length - 1; index++) {
    if (typeof current !== "object" || current === null) return null;
    const part = path[index]!;
    if (!Object.hasOwn(current, part)) return null;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  if (typeof current !== "object" || current === null) return null;
  return {
    parent: current as Record<PropertyKey, unknown> | unknown[],
    key: path.at(-1)!,
  };
}

function projectExplicitContextRecordInPlace(
  context: Record<string, unknown>,
  projection: WorkflowContextProjection,
  visited = new WeakSet<object>(),
): void {
  if (visited.has(context)) return;
  visited.add(context);
  for (const [root, paths] of Object.entries(projection)) {
    if (!Object.hasOwn(context, root)) continue;
    for (const entry of paths) {
      if (entry.path.length === 0) {
        if (entry.kind === INTERNAL_RUNTIME_PROJECTION_KIND) {
          Reflect.deleteProperty(context, root);
        } else if (
          entry.kind === FRAMEWORK_CONTEXT_PROJECTION_KIND && isRecord(context[root])
        ) {
          deleteOwnKeys(context[root], DEFAULT_OUTPUT_INTERNAL_KEYS);
        }
        continue;
      }
      const target = getProjectionTarget(context[root], entry.path);
      if (!target || !Object.hasOwn(target.parent, target.key)) continue;
      if (entry.kind === INTERNAL_RUNTIME_PROJECTION_KIND) {
        Reflect.deleteProperty(target.parent, target.key);
        continue;
      }
      const value = (target.parent as Record<PropertyKey, unknown>)[target.key];
      if (isRecord(value)) {
        deleteOwnKeys(value, DEFAULT_OUTPUT_INTERNAL_KEYS);
      }
    }
  }
}

function projectExplicitValueInPlace(
  value: unknown,
  paths: readonly WorkflowProjectionPath[],
): unknown {
  const projected = value;
  for (const entry of paths) {
    if (entry.path.length === 0) {
      if (entry.kind === INTERNAL_RUNTIME_PROJECTION_KIND) return undefined;
      if (isRecord(projected)) {
        deleteOwnKeys(projected, DEFAULT_OUTPUT_INTERNAL_KEYS);
      }
      continue;
    }
    const target = getProjectionTarget(projected, entry.path);
    if (!target || !Object.hasOwn(target.parent, target.key)) continue;
    if (entry.kind === INTERNAL_RUNTIME_PROJECTION_KIND) {
      Reflect.deleteProperty(target.parent, target.key);
      continue;
    }
    const nested = (target.parent as Record<PropertyKey, unknown>)[target.key];
    if (isRecord(nested)) {
      deleteOwnKeys(nested, DEFAULT_OUTPUT_INTERNAL_KEYS);
    }
  }
  return projected;
}

interface FrameworkContextMetadata {
  readonly hasEnv: boolean;
  readonly env?: unknown;
  readonly hasTenant: boolean;
  readonly tenant?: unknown;
}

function captureFrameworkContextMetadata(
  context: WorkflowContext,
  inheritedTenant?: unknown,
): FrameworkContextMetadata {
  const hasEnv = Object.hasOwn(context, "env");
  const hasContextTenant = Object.hasOwn(context, "_tenant");
  return {
    hasEnv,
    env: hasEnv ? context.env : undefined,
    hasTenant: hasContextTenant || inheritedTenant !== undefined,
    tenant: hasContextTenant ? context._tenant : inheritedTenant,
  };
}

function isPersistedLoopRuntimeState(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.iteration) &&
    Array.isArray(value.previousResults) &&
    (Object.hasOwn(value, "iterationNodeStates") ||
      Object.hasOwn(value, "stepsEvaluationContext"));
}

/**
 * Historical composite/sub-workflow outputs can contain an entire execution
 * context. Correlate nested metadata with the enclosing durable run instead of
 * guessing from node IDs or user-owned output shape.
 */
function projectNestedFrameworkContextsInPlace(
  value: unknown,
  metadata: FrameworkContextMetadata,
  visited = new WeakSet<object>(),
  securityFirstLegacy = false,
  projectCurrentRecord = true,
): void {
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      projectNestedFrameworkContextsInPlace(entry, metadata, visited, securityFirstLegacy);
    }
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (key.endsWith("_loop_state") && isPersistedLoopRuntimeState(nested)) {
      Reflect.deleteProperty(value, key);
    }
  }

  if (Object.hasOwn(value, "input")) {
    if (securityFirstLegacy && projectCurrentRecord) {
      // Unversioned records predate durable provenance and cannot distinguish
      // a raw execution context from an identically shaped user value. The
      // legacy policy is intentionally confidentiality-first.
      deleteOwnKeys(value, DEFAULT_OUTPUT_INTERNAL_KEYS);
    }
  }

  for (const nested of Object.values(value)) {
    projectNestedFrameworkContextsInPlace(nested, metadata, visited, securityFirstLegacy);
  }
}

interface ProvenanceOutputProjection {
  readonly nodeId: string;
  readonly rawOutput: unknown;
  readonly publicOutput: unknown;
}

function replaceProvenanceOutputsInPlace(
  value: unknown,
  projections: readonly ProvenanceOutputProjection[],
  visited = new WeakSet<object>(),
): void {
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) replaceProvenanceOutputsInPlace(entry, projections, visited);
    return;
  }
  if (!isRecord(value)) return;

  for (const projection of projections) {
    if (
      Object.hasOwn(value, projection.nodeId) &&
      workflowRuntimeValuesEqual(value[projection.nodeId], projection.rawOutput)
    ) {
      value[projection.nodeId] = structuredClone(projection.publicOutput);
    }
  }
  for (const nested of Object.values(value)) {
    replaceProvenanceOutputsInPlace(nested, projections, visited);
  }
}

function projectFrameworkContextRecord(
  value: Record<string, unknown>,
  metadata?: FrameworkContextMetadata,
  provenanceOutputs: readonly ProvenanceOutputProjection[] = [],
  securityFirstLegacy = false,
): Record<string, unknown> {
  const projected = structuredClone(value);
  deleteOwnKeys(projected, DEFAULT_OUTPUT_INTERNAL_KEYS);
  replaceProvenanceOutputsInPlace(projected, provenanceOutputs);
  if (metadata) {
    projectNestedFrameworkContextsInPlace(projected, metadata, undefined, securityFirstLegacy);
  }
  return projected;
}

function projectNodeStatesInPlace(
  nodeStates: Record<string, NodeState>,
  metadata: FrameworkContextMetadata,
  securityFirstLegacy: boolean,
  authoritativeInputNodeIds: ReadonlySet<string> = new Set(),
): ProvenanceOutputProjection[] {
  const provenanceOutputs: ProvenanceOutputProjection[] = [];
  const mapOutputs: Array<{
    state: NodeState;
    rawOutput: unknown;
    childNodeIds: string[];
  }> = [];
  for (const state of Object.values(nodeStates)) {
    const explicitOutputProjection = captureWorkflowProjectionPaths(
      (state as Record<string, unknown>)[INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD],
    );
    const isPersistedSubWorkflow = Object.hasOwn(state, INTERNAL_SUBWORKFLOW_STATE_FIELD);
    const hasSubWorkflowContextOutput =
      (state as Record<string, unknown>)[INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD] ===
        SUBWORKFLOW_CONTEXT_OUTPUT_KIND;
    const hasSubWorkflowInput = authoritativeInputNodeIds.has(state.nodeId) ||
      (state as Record<string, unknown>)[INTERNAL_WORKFLOW_INPUT_KIND_FIELD] ===
        SUBWORKFLOW_INPUT_KIND;
    const rawMapChildNodeIds = (state as Record<string, unknown>)[
      INTERNAL_MAP_CHILD_NODE_IDS_FIELD
    ];
    if (
      securityFirstLegacy && Array.isArray(rawMapChildNodeIds) &&
      rawMapChildNodeIds.every((id) => typeof id === "string")
    ) {
      mapOutputs.push({
        state,
        rawOutput: structuredClone(state.output),
        childNodeIds: [...rawMapChildNodeIds],
      });
    }
    if (hasSubWorkflowInput) Reflect.deleteProperty(state, "input");
    if (isRecord(state.input)) Reflect.deleteProperty(state.input, INTERNAL_WAIT_KIND_FIELD);
    Reflect.deleteProperty(state, INTERNAL_MAP_ITEMS_FIELD);
    Reflect.deleteProperty(state, INTERNAL_MAP_CONTEXT_FIELD);
    Reflect.deleteProperty(state, INTERNAL_MAP_CONTEXT_PROJECTION_FIELD);
    Reflect.deleteProperty(state, INTERNAL_MAP_CHILD_NODE_IDS_FIELD);
    Reflect.deleteProperty(state, INTERNAL_SUBWORKFLOW_STATE_FIELD);
    Reflect.deleteProperty(state, INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD);
    Reflect.deleteProperty(state, "_subWorkflowOwnerPath");
    Reflect.deleteProperty(state, "_activeCompositeChildIds");
    Reflect.deleteProperty(state, "_completedCompositeChildIds");
    Reflect.deleteProperty(state, INTERNAL_WORKFLOW_INPUT_KIND_FIELD);
    Reflect.deleteProperty(state, INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD);
    Reflect.deleteProperty(state, INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD);
    if (!securityFirstLegacy && explicitOutputProjection.length > 0) {
      state.output = projectExplicitValueInPlace(state.output, explicitOutputProjection);
    } else if (
      securityFirstLegacy && (isPersistedSubWorkflow || hasSubWorkflowContextOutput) &&
      isRecord(state.output)
    ) {
      const rawOutput = structuredClone(state.output);
      state.output = projectFrameworkContextRecord(state.output, metadata);
      if (hasSubWorkflowContextOutput) {
        provenanceOutputs.push({
          nodeId: state.nodeId,
          rawOutput,
          publicOutput: structuredClone(state.output),
        });
      }
    } else if (securityFirstLegacy) {
      projectNestedFrameworkContextsInPlace(
        state.output,
        metadata,
        undefined,
        securityFirstLegacy,
      );
    }
  }

  mapOutputs.sort((left, right) => right.state.nodeId.length - left.state.nodeId.length);
  for (const mapOutput of mapOutputs) {
    if (!Array.isArray(mapOutput.state.output)) continue;
    mapOutput.state.output = mapOutput.childNodeIds.map((childNodeId) =>
      structuredClone(nodeStates[childNodeId]?.output)
    );
    provenanceOutputs.push({
      nodeId: mapOutput.state.nodeId,
      rawOutput: mapOutput.rawOutput,
      publicOutput: structuredClone(mapOutput.state.output),
    });
  }

  if (securityFirstLegacy) {
    for (const state of Object.values(nodeStates)) {
      replaceProvenanceOutputsInPlace(state.output, provenanceOutputs);
    }
  }
  return provenanceOutputs;
}

function projectContextInPlace(
  context: WorkflowContext,
  metadata: FrameworkContextMetadata,
  provenanceOutputs: readonly ProvenanceOutputProjection[] = [],
  securityFirstLegacy = false,
  explicitProjection: WorkflowContextProjection = {},
): void {
  if (!securityFirstLegacy) {
    projectExplicitContextRecordInPlace(context, explicitProjection);
    deleteOwnKeys(context, INTERNAL_CONTEXT_KEYS);
    return;
  }
  deleteOwnKeys(context, INTERNAL_CONTEXT_KEYS);
  replaceProvenanceOutputsInPlace(context, provenanceOutputs);
  projectNestedFrameworkContextsInPlace(
    context,
    metadata,
    undefined,
    securityFirstLegacy,
    false,
  );
}

/** Detach workflow context and remove framework-owned execution metadata. */
export function toPublicWorkflowContext(
  context: WorkflowContext,
  projection: WorkflowContextProjection = {},
): WorkflowContext {
  const projected = structuredClone(context);
  projectExplicitContextRecordInPlace(projected, projection);
  deleteOwnKeys(projected, INTERNAL_CONTEXT_KEYS);
  return projected;
}

/** Project a persisted default workflow result, including historical records. */
export function toPublicWorkflowOutput<T>(
  output: T,
  frameworkContext?: WorkflowContext,
): T {
  const projected = structuredClone(output);
  if (!isRecord(projected)) return projected;
  const metadata = frameworkContext === undefined
    ? undefined
    : captureFrameworkContextMetadata(frameworkContext);
  return projectFrameworkContextRecord(projected, metadata) as T;
}

/** Materialize the default workflow result without framework-owned context fields. */
export function toDefaultWorkflowOutput(
  context: WorkflowContext,
  projection: WorkflowContextProjection = {},
): Record<string, unknown> {
  const projected = structuredClone(context);
  projectExplicitContextRecordInPlace(projected, projection);
  deleteOwnKeys(projected, DEFAULT_OUTPUT_INTERNAL_KEYS);
  return projected;
}

/**
 * Materialize a composite node result from its explicit child delta.
 * Nested tool values are user-owned and intentionally remain untouched.
 */
export function materializeWorkflowContextDelta(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return projectFrameworkContextRecord(values);
}

/** Detach a durable run for public callbacks and read APIs. */
export function toPublicWorkflowRun(run: WorkflowRun): WorkflowRun {
  const projected = structuredClone(run);
  if (projected._runtimeStateVersion !== WORKFLOW_RUNTIME_STATE_VERSION) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Cannot safely expose workflow run "${projected.id}": its legacy runtime state ` +
        "has ambiguous public-data provenance; migration is required",
    });
  }
  const metadata = captureFrameworkContextMetadata(projected.context, projected._tenant);
  const securityFirstLegacy = false;
  const runContextProjection = captureWorkflowContextProjection(
    projected._workflowProjection?.context,
  );
  Reflect.deleteProperty(projected, "_tenant");
  Reflect.deleteProperty(projected, INTERNAL_WORKFLOW_RUNTIME_STATE_VERSION_FIELD);
  Reflect.deleteProperty(projected, INTERNAL_WORKFLOW_PROJECTION_STATE_FIELD);
  Reflect.deleteProperty(projected, INTERNAL_WORKFLOW_TRACE_CONTEXT_FIELD);

  const authoritativeInputNodeIds = new Set(
    Object.values(projected.nodeStates)
      .filter((state) =>
        (state as Record<string, unknown>)[INTERNAL_WORKFLOW_INPUT_KIND_FIELD] ===
          SUBWORKFLOW_INPUT_KIND
      )
      .map((state) => state.nodeId),
  );
  const provenanceOutputs = projectNodeStatesInPlace(
    projected.nodeStates,
    metadata,
    securityFirstLegacy,
    authoritativeInputNodeIds,
  );
  projectContextInPlace(
    projected.context,
    metadata,
    provenanceOutputs,
    securityFirstLegacy,
    runContextProjection,
  );
  if (projected.output !== undefined) {
    const publicOutput = structuredClone(projected.output);
    if (securityFirstLegacy && isRecord(publicOutput)) {
      projected.output = projectFrameworkContextRecord(
        publicOutput,
        metadata,
        provenanceOutputs,
        true,
      );
    } else projected.output = publicOutput;
  }

  for (const checkpoint of projected.checkpoints) {
    const checkpointMetadata = captureFrameworkContextMetadata(checkpoint.context, metadata.tenant);
    const checkpointInputKind = checkpoint._workflowProjection?.inputKind;
    const checkpointContextProjection = captureWorkflowContextProjection(
      checkpoint._workflowProjection?.context,
    );
    const checkpointProvenance = projectNodeStatesInPlace(
      checkpoint.nodeStates,
      checkpointMetadata,
      securityFirstLegacy,
      authoritativeInputNodeIds,
    );
    projectContextInPlace(
      checkpoint.context,
      checkpointMetadata,
      checkpointProvenance,
      securityFirstLegacy,
      checkpointContextProjection,
    );
    Reflect.deleteProperty(checkpoint, INTERNAL_WORKFLOW_PROJECTION_STATE_FIELD);
    Reflect.deleteProperty(checkpoint, "_resumeEnvelope");
    if (
      authoritativeInputNodeIds.has(checkpoint.nodeId) ||
      checkpointInputKind === SUBWORKFLOW_INPUT_KIND
    ) {
      Reflect.deleteProperty(checkpoint.context, "input");
    }
  }
  Reflect.deleteProperty(projected, "workerId");
  Reflect.deleteProperty(projected, "heartbeatAt");
  if (projected.error) projected.error = { message: projected.error.message };
  return projected;
}

/** Detach durable runs for public list APIs. */
export function toPublicWorkflowRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs.map(toPublicWorkflowRun);
}
