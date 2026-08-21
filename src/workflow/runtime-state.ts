/** Internal durable snapshot of one map node's admitted item selection. */
export const INTERNAL_MAP_ITEMS_FIELD = "_mapItems";

/** Internal durable child context required to resume a paused map processor. */
export const INTERNAL_MAP_CONTEXT_FIELD = "_mapContext";

/** Internal durable projection sidecar for a paused map processor context. */
export const INTERNAL_MAP_CONTEXT_PROJECTION_FIELD = "_mapContextProjection";

/** Internal ordered child identities used to project positional map outputs. */
export const INTERNAL_MAP_CHILD_NODE_IDS_FIELD = "_mapChildNodeIds";

/** Internal durable state required to re-enter one paused sub-workflow. */
export const INTERNAL_SUBWORKFLOW_STATE_FIELD = "_subWorkflowState";

/** Internal provenance for node outputs that contain a full workflow context. */
export const INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD = "_workflowOutputKind";

/** Provenance value for the default output of a sub-workflow node. */
export const SUBWORKFLOW_CONTEXT_OUTPUT_KIND = "subWorkflowContext";

/** Internal provenance for framework-owned node input snapshots. */
export const INTERNAL_WORKFLOW_INPUT_KIND_FIELD = "_workflowInputKind";

/** Provenance value for descendant inputs inherited from a sub-workflow. */
export const SUBWORKFLOW_INPUT_KIND = "subWorkflowInput";

import { isDeepStrictEqual } from "node:util";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { WorkflowContext } from "./types.ts";

/** Internal run/checkpoint sidecar carrying public projection ownership. */
export const INTERNAL_WORKFLOW_PROJECTION_STATE_FIELD = "_workflowProjection";

/** Internal path ownership carried by one durable node output. */
export const INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD = "_workflowOutputProjection";

/** Internal cumulative child delta retained across immediate composite retries. */
export const INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD = "_compositeContextPatch";

/** A marked value is a framework execution context whose root metadata is private. */
export const FRAMEWORK_CONTEXT_PROJECTION_KIND = "frameworkContext";

/** A marked value is runtime bookkeeping and is absent from public state. */
export const INTERNAL_RUNTIME_PROJECTION_KIND = "internalRuntime";

export type WorkflowProjectionKind =
  | typeof FRAMEWORK_CONTEXT_PROJECTION_KIND
  | typeof INTERNAL_RUNTIME_PROJECTION_KIND;

/** A path is relative to its owning top-level context slot or node output. */
export interface WorkflowProjectionPath {
  readonly kind: WorkflowProjectionKind;
  readonly path: readonly (string | number)[];
}

export type WorkflowContextProjection = Record<string, WorkflowProjectionPath[]>;

/** Framework-only durable sidecar; it is never inserted into user context. */
export interface WorkflowProjectionState {
  readonly context: WorkflowContextProjection;
  /** Execution-scope provenance stamped before descendant checkpoints are saved. */
  readonly inputKind?: typeof SUBWORKFLOW_INPUT_KIND;
}

/** Current durable provenance model for newly admitted workflow runs. */
export const WORKFLOW_RUNTIME_STATE_VERSION = 2;

/** Immutable internal run field carrying the durable provenance model version. */
export const INTERNAL_WORKFLOW_RUNTIME_STATE_VERSION_FIELD = "_runtimeStateVersion";

/**
 * Internal run field carrying the last execution's W3C `traceparent`.
 *
 * Framework-only: it exists so the next execution can link its span to the
 * previous one, and it names internal infrastructure, so it is stripped from
 * every public run projection alongside the other `_`-prefixed fields.
 */
export const INTERNAL_WORKFLOW_TRACE_CONTEXT_FIELD = "_traceContext";

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cycle-safe structural equality for detached durable workflow values. */
export function workflowRuntimeValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return isDeepStrictEqual(left, right);
}

function isProjectionPathComponent(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function isWorkflowProjectionPath(value: unknown): value is WorkflowProjectionPath {
  if (!isRuntimeRecord(value) || !Array.isArray(value.path)) return false;
  if (
    value.kind !== FRAMEWORK_CONTEXT_PROJECTION_KIND &&
    value.kind !== INTERNAL_RUNTIME_PROJECTION_KIND
  ) return false;
  return value.path.every(isProjectionPathComponent);
}

/** Detach a validated list of internal output-projection paths. */
export function captureWorkflowProjectionPaths(value: unknown): WorkflowProjectionPath[] {
  if (!Array.isArray(value) || !value.every(isWorkflowProjectionPath)) return [];
  return value.map((entry) => ({ kind: entry.kind, path: [...entry.path] }));
}

/** Detach a validated context projection sidecar. */
export function captureWorkflowContextProjection(value: unknown): WorkflowContextProjection {
  if (!isRuntimeRecord(value)) return {};
  const projection = Object.create(null) as WorkflowContextProjection;
  for (const [root, paths] of Object.entries(value)) {
    if (!Array.isArray(paths) || !paths.every(isWorkflowProjectionPath)) continue;
    defineProjectionRoot(
      projection,
      root,
      paths.map((entry) => ({ kind: entry.kind, path: [...entry.path] })),
    );
  }
  return projection;
}

/** Read a detached projection snapshot for one top-level workflow context slot. */
export function getWorkflowContextRootProjection(
  projection: WorkflowContextProjection,
  root: string,
): WorkflowProjectionPath[] {
  return captureWorkflowProjectionPaths(projection[root]);
}

/** Replace the projection paths owned by one top-level workflow context slot. */
export function replaceWorkflowContextRootProjection(
  projection: WorkflowContextProjection,
  root: string,
  paths: readonly WorkflowProjectionPath[],
): void {
  if (paths.length === 0) Reflect.deleteProperty(projection, root);
  else {
    defineProjectionRoot(
      projection,
      root,
      paths.map((entry) => ({ kind: entry.kind, path: [...entry.path] })),
    );
  }
}

function defineProjectionRoot(
  projection: WorkflowContextProjection,
  root: string,
  paths: WorkflowProjectionPath[],
): void {
  Object.defineProperty(projection, root, {
    value: paths,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

interface ProjectionTargetSnapshot {
  readonly root: string;
  readonly index: number;
  readonly exists: boolean;
  readonly value: unknown;
}

function getOwnPathValue(
  context: WorkflowContext,
  root: string,
  path: readonly (string | number)[],
): { exists: boolean; value: unknown } {
  let value: unknown = context;
  for (const part of [root, ...path]) {
    if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
      return { exists: false, value: undefined };
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, part);
    } catch {
      return { exists: false, value: undefined };
    }
    if (!descriptor || !("value" in descriptor)) {
      return { exists: false, value: undefined };
    }
    value = descriptor.value;
  }
  return { exists: true, value };
}

function captureProjectionTargets(
  context: WorkflowContext,
  projection: WorkflowContextProjection,
): ProjectionTargetSnapshot[] {
  return Object.entries(projection).flatMap(([root, paths]) =>
    paths.map((entry, index) => ({
      root,
      index,
      ...getOwnPathValue(context, root, entry.path),
    }))
  );
}

function reconcileProjectionTargets(
  context: WorkflowContext,
  projection: WorkflowContextProjection,
  snapshots: readonly ProjectionTargetSnapshot[],
): void {
  const invalid = new Map<string, Set<number>>();
  for (const snapshot of snapshots) {
    const current = getOwnPathValue(
      context,
      snapshot.root,
      projection[snapshot.root]?.[snapshot.index]?.path ?? [],
    );
    if (!snapshot.exists || !current.exists || !Object.is(snapshot.value, current.value)) {
      const indexes = invalid.get(snapshot.root) ?? new Set<number>();
      indexes.add(snapshot.index);
      invalid.set(snapshot.root, indexes);
    }
  }
  for (const [root, indexes] of invalid) {
    const retained = (projection[root] ?? []).filter((_entry, index) => !indexes.has(index));
    replaceWorkflowContextRootProjection(projection, root, retained);
  }
}

/**
 * Invoke a user callback with ordinary structured-cloneable context while
 * clearing only projection targets whose exact object identity was replaced.
 */
export async function runWithWorkflowContextProjectionTracking<T>(
  context: WorkflowContext,
  projection: WorkflowContextProjection,
  callback: (context: WorkflowContext) => T | Promise<T>,
): Promise<T> {
  const snapshots = captureProjectionTargets(context, projection);
  try {
    return await callback(context);
  } finally {
    reconcileProjectionTargets(context, projection, snapshots);
  }
}
