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

const arrayIsArray = Array.isArray;
const MapConstructor = Map;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const objectIs = Object.is;
const reflectApply = Reflect.apply;
const reflectDeleteProperty = Reflect.deleteProperty;
const reflectOwnKeys = Reflect.ownKeys;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

function defineArrayElement<T>(values: T[], index: number, value: T): void {
  objectDefineProperty(values, index, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

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
  return typeof value === "object" && value !== null && !arrayIsArray(value) &&
    !isProxyWithoutHooks(value);
}

/** Cycle-safe structural equality for detached durable workflow values. */
export function workflowRuntimeValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return isDeepStrictEqual(left, right);
}

function isProjectionPathComponent(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && numberIsSafeInteger(value));
}

function readOwnData(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = objectGetOwnPropertyDescriptor(value, key);
  return descriptor && objectHasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function captureProjectionPath(value: unknown): WorkflowProjectionPath | null {
  if (!isRuntimeRecord(value)) return null;
  const kind = readOwnData(value, "kind");
  const sourcePath = readOwnData(value, "path");
  if (
    (kind !== FRAMEWORK_CONTEXT_PROJECTION_KIND && kind !== INTERNAL_RUNTIME_PROJECTION_KIND) ||
    !arrayIsArray(sourcePath) || isProxyWithoutHooks(sourcePath)
  ) return null;

  const path: Array<string | number> = [];
  for (let index = 0; index < sourcePath.length; index++) {
    const component = readOwnData(sourcePath, index);
    if (!isProjectionPathComponent(component)) return null;
    defineArrayElement(path, index, component);
  }
  return { kind, path };
}

/** Detach a validated list of internal output-projection paths. */
export function captureWorkflowProjectionPaths(value: unknown): WorkflowProjectionPath[] {
  if (!arrayIsArray(value) || isProxyWithoutHooks(value)) return [];
  const paths: WorkflowProjectionPath[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = captureProjectionPath(readOwnData(value, index));
    if (!entry) return [];
    defineArrayElement(paths, index, entry);
  }
  return paths;
}

/** Detach a validated context projection sidecar. */
export function captureWorkflowContextProjection(value: unknown): WorkflowContextProjection {
  if (!isRuntimeRecord(value)) return {};
  const projection = objectCreate(null) as WorkflowContextProjection;
  const roots = reflectOwnKeys(value);
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!;
    if (typeof root !== "string") continue;
    const descriptor = objectGetOwnPropertyDescriptor(value, root);
    if (!descriptor?.enumerable || !objectHasOwn(descriptor, "value")) continue;
    const paths = captureWorkflowProjectionPaths(descriptor.value);
    if (paths.length === 0 && (!arrayIsArray(descriptor.value) || descriptor.value.length > 0)) {
      continue;
    }
    defineProjectionRoot(projection, root, paths);
  }
  return projection;
}

/** Read a detached projection snapshot for one top-level workflow context slot. */
export function getWorkflowContextRootProjection(
  projection: WorkflowContextProjection,
  root: string,
): WorkflowProjectionPath[] {
  try {
    return captureWorkflowProjectionPaths(readOwnData(projection, root));
  } catch {
    return [];
  }
}

/** Replace the projection paths owned by one top-level workflow context slot. */
export function replaceWorkflowContextRootProjection(
  projection: WorkflowContextProjection,
  root: string,
  paths: readonly WorkflowProjectionPath[],
): void {
  const captured = captureWorkflowProjectionPaths(paths);
  if (captured.length === 0) reflectDeleteProperty(projection, root);
  else {
    defineProjectionRoot(projection, root, captured);
  }
}

function defineProjectionRoot(
  projection: WorkflowContextProjection,
  root: string,
  paths: WorkflowProjectionPath[],
): void {
  objectDefineProperty(projection, root, {
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
  for (let index = -1; index < path.length; index++) {
    const part = index === -1 ? root : path[index]!;
    if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
      return { exists: false, value: undefined };
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(value, part);
    } catch {
      return { exists: false, value: undefined };
    }
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
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
  const snapshots: ProjectionTargetSnapshot[] = [];
  const roots = reflectOwnKeys(projection);
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex]!;
    if (typeof root !== "string") continue;
    const paths = getWorkflowContextRootProjection(projection, root);
    for (let index = 0; index < paths.length; index++) {
      defineArrayElement(snapshots, snapshots.length, {
        root,
        index,
        ...getOwnPathValue(context, root, paths[index]!.path),
      });
    }
  }
  return snapshots;
}

function reconcileProjectionTargets(
  context: WorkflowContext,
  projection: WorkflowContextProjection,
  snapshots: readonly ProjectionTargetSnapshot[],
): void {
  const invalid = new MapConstructor<string, Set<number>>();
  const invalidRoots: string[] = [];
  for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex++) {
    const snapshot = snapshots[snapshotIndex]!;
    const paths = getWorkflowContextRootProjection(projection, snapshot.root);
    const current = getOwnPathValue(
      context,
      snapshot.root,
      paths[snapshot.index]?.path ?? [],
    );
    if (!snapshot.exists || !current.exists || !objectIs(snapshot.value, current.value)) {
      let indexes = reflectApply(mapGet, invalid, [snapshot.root]) as Set<number> | undefined;
      if (!indexes) {
        indexes = new SetConstructor<number>();
        reflectApply(mapSet, invalid, [snapshot.root, indexes]);
        defineArrayElement(invalidRoots, invalidRoots.length, snapshot.root);
      }
      reflectApply(setAdd, indexes, [snapshot.index]);
    }
  }
  for (let rootIndex = 0; rootIndex < invalidRoots.length; rootIndex++) {
    const root = invalidRoots[rootIndex]!;
    const indexes = reflectApply(mapGet, invalid, [root]) as Set<number>;
    const paths = getWorkflowContextRootProjection(projection, root);
    const retained: WorkflowProjectionPath[] = [];
    for (let index = 0; index < paths.length; index++) {
      if (!reflectApply(setHas, indexes, [index])) {
        defineArrayElement(retained, retained.length, paths[index]!);
      }
    }
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
