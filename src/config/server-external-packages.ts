import {
  primordialArrayPush,
  primordialArraySort,
} from "#veryfront/platform/compat/primordials/array.ts";

export const MAX_SERVER_EXTERNAL_PACKAGE_COUNT = 128;
export const MAX_SERVER_EXTERNAL_PACKAGE_NAME_LENGTH = 214;

const ObjectFreeze = Object.freeze;
const RegExpExec = RegExp.prototype.exec;
const ReflectApply = Reflect.apply;
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;
const SERVER_EXTERNAL_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Return whether a value names one bare npm package root. */
export function isValidServerExternalPackageName(value: string): boolean {
  return value.length <= MAX_SERVER_EXTERNAL_PACKAGE_NAME_LENGTH &&
    ReflectApply(RegExpExec, SERVER_EXTERNAL_PACKAGE_PATTERN, [value]) !== null;
}

/** Return whether every configured package name occurs exactly once. */
export function hasUniqueServerExternalPackages(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (ReflectApply(SetHas, seen, [value]) as boolean) return false;
    ReflectApply(SetAdd, seen, [value]);
  }
  return true;
}

/** Capture an immutable, order-independent package list for one transform graph. */
export function canonicalizeServerExternalPackages(
  values: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!values || values.length === 0) return undefined;

  const canonical: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (ReflectApply(SetHas, seen, [value]) as boolean) continue;
    ReflectApply(SetAdd, seen, [value]);
    primordialArrayPush(canonical, value);
  }
  primordialArraySort(canonical, (left, right) => left < right ? -1 : left > right ? 1 : 0);
  return ObjectFreeze(canonical);
}

/** Build a stable framed identity for cache keys whose output depends on this list. */
export function buildServerExternalPackagesIdentity(
  values: readonly string[] | undefined,
): string | undefined {
  const canonical = canonicalizeServerExternalPackages(values);
  if (!canonical) return undefined;

  let identity = "";
  for (let index = 0; index < canonical.length; index++) {
    const value = canonical[index]!;
    identity += `${value.length}:${value};`;
  }
  return identity;
}
