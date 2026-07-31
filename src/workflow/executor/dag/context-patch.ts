import { isDeepStrictEqual } from "node:util";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowContext } from "../../types.ts";
import type { ContextPatch } from "./types.ts";
import {
  getWorkflowContextRootProjection,
  replaceWorkflowContextRootProjection,
  type WorkflowContextProjection,
  type WorkflowProjectionPath,
} from "../../runtime-state.ts";

/** An explicit top-level patch. A key is either set or deleted, never both. */
export interface RecordPatch<T> {
  set: Record<string, T>;
  delete: string[];
}

/**
 * Clone execution state at an isolation boundary.
 *
 * Workflow context is durable state and must therefore be structured-cloneable.
 * Using the same operation as checkpoints keeps in-memory execution semantics
 * aligned with checkpoint and resume behavior.
 */
export function cloneExecutionState<T>(value: T, label: string): T {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must contain only structured-cloneable values`,
      cause,
    });
  }
}

export function createRecordPatch<T>(
  before: Record<string, T>,
  after: Record<string, T>,
): RecordPatch<T> {
  const set = Object.create(null) as Record<string, T>;
  const deleted: string[] = [];

  for (const key of Object.keys(before)) {
    if (!Object.hasOwn(after, key)) deleted.push(key);
  }

  for (const key of Object.keys(after)) {
    if (Object.hasOwn(before, key) && isDeepStrictEqual(before[key], after[key])) continue;
    defineOwnValue(set, key, after[key]!);
  }

  return { set, delete: deleted };
}

export function createContextPatch(
  before: WorkflowContext,
  after: WorkflowContext,
  beforeProjection: WorkflowContextProjection = {},
  afterProjection: WorkflowContextProjection = {},
): ContextPatch {
  const patch = createRecordPatch(before, after);
  const projection: Record<string, WorkflowProjectionPath[]> = Object.create(null);
  for (const key of [...Object.keys(patch.set), ...patch.delete]) {
    projection[key] = getWorkflowContextRootProjection(afterProjection, key);
  }
  const projectionRoots = new Set([
    ...Object.keys(beforeProjection),
    ...Object.keys(afterProjection),
  ]);
  for (const key of projectionRoots) {
    const beforePaths = getWorkflowContextRootProjection(beforeProjection, key);
    const afterPaths = getWorkflowContextRootProjection(afterProjection, key);
    if (!isDeepStrictEqual(beforePaths, afterPaths)) projection[key] = afterPaths;
  }
  return { ...patch, projection };
}

export function createSetContextPatch(
  values: Record<string, unknown> = {},
  projectionByRoot: Readonly<Record<string, readonly WorkflowProjectionPath[]>> = {},
): ContextPatch {
  const set = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) defineOwnValue(set, key, value);
  const projection = Object.create(null) as Record<string, WorkflowProjectionPath[]>;
  for (const key of new Set([...Object.keys(values), ...Object.keys(projectionByRoot)])) {
    projection[key] = (projectionByRoot[key] ?? []).map((entry) => ({
      kind: entry.kind,
      path: [...entry.path],
    }));
  }
  return { set, delete: [], projection };
}

/** Merge patches in order. A later operation wins when patches touch the same key. */
export function mergeContextPatches(...patches: ContextPatch[]): ContextPatch {
  const merged = createSetContextPatch();
  const deleted = new Set<string>();

  for (const patch of patches) {
    for (const key of patch.delete) {
      Reflect.deleteProperty(merged.set, key);
      deleted.add(key);
      merged.projection[key] = [];
    }
    for (const [key, value] of Object.entries(patch.set)) {
      deleted.delete(key);
      defineOwnValue(merged.set, key, value);
    }
    const projectionRoots = new Set([
      ...patch.delete,
      ...Object.keys(patch.set),
      ...Object.keys(patch.projection),
    ]);
    for (const key of projectionRoots) {
      merged.projection[key] = (patch.projection[key] ?? []).map((entry) => ({
        kind: entry.kind,
        path: [...entry.path],
      }));
    }
  }

  merged.delete = [...deleted];
  return merged;
}

/**
 * Apply one node's patch. The executor calls this in node declaration order,
 * which makes a later node the deterministic winner for same-key writes.
 */
export function applyRecordPatch<T>(target: Record<string, T>, patch: RecordPatch<T>): void {
  for (const key of patch.delete) Reflect.deleteProperty(target, key);
  for (const [key, value] of Object.entries(patch.set)) defineOwnValue(target, key, value);
}

export function applyContextPatch(
  target: WorkflowContext,
  patch: ContextPatch,
  projection?: WorkflowContextProjection,
): void {
  applyRecordPatch(target, patch);
  if (!projection) return;
  const projectionRoots = new Set([
    ...Object.keys(patch.set),
    ...patch.delete,
    ...Object.keys(patch.projection),
  ]);
  for (const key of projectionRoots) {
    replaceWorkflowContextRootProjection(projection, key, patch.projection[key] ?? []);
  }
}

/** Read only an own record entry, never an inherited prototype property. */
export function getOwnRecordValue<T>(target: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(target, key) ? target[key] : undefined;
}

/** Define an own record entry without invoking the legacy __proto__ setter. */
export function setOwnRecordValue<T>(target: Record<string, T>, key: string, value: T): void {
  defineOwnValue(target, key, value);
}

function defineOwnValue<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
