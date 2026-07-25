/**
 * Atomic import-map identity for transform and cache boundaries.
 *
 * Constructing the map and its fingerprint independently can transform with
 * one map while publishing into another map's cache namespace. The factory
 * snapshots the map, derives its canonical digest, and privately brands the
 * immutable pair so consumers can reject forged partial values.
 */

import {
  fingerprintPipelineImportMap,
  snapshotImportMap,
} from "#veryfront/transforms/pipeline/cache-identity.ts";
import type { ImportMapConfig } from "./types.ts";

const IntrinsicWeakSet = WeakSet;
const IntrinsicTypeError = TypeError;
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const trustedImportMapIdentities = new IntrinsicWeakSet<object>();

export interface ImportMapIdentity {
  readonly importMap: ImportMapConfig;
  readonly fingerprint: string;
}

export async function createImportMapIdentity(
  importMap: unknown,
): Promise<ImportMapIdentity> {
  const snapshot = snapshotImportMap(importMap);
  const identity = ObjectFreeze({
    importMap: snapshot,
    fingerprint: await fingerprintPipelineImportMap(snapshot),
  });
  ReflectApply(WeakSetPrototypeAdd, trustedImportMapIdentities, [identity]);
  return identity;
}

export function assertImportMapIdentity(
  value: unknown,
): asserts value is ImportMapIdentity {
  if (
    value === null ||
    typeof value !== "object" ||
    !(ReflectApply(
      WeakSetPrototypeHas,
      trustedImportMapIdentities,
      [value],
    ) as boolean)
  ) {
    throw new IntrinsicTypeError(
      "Import-map identity must be created with createImportMapIdentity()",
    );
  }
}
