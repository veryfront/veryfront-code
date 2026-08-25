import {
  hasWindowsLikePath,
  portableIsAbsolute,
  portableNormalize,
  portableRelative,
  portableResolve,
  removeTrailingSeparatorsExceptRoot,
  runtimeUsesWindowsPaths,
  toPortableSeparators,
} from "./portable.ts";
import { getNativePathImplementation } from "./runtime.ts";

const apply = Reflect.apply;

function usesWindowsFlavor(paths: readonly string[]): boolean {
  if (runtimeUsesWindowsPaths()) return true;
  for (let index = 0; index < paths.length; index++) {
    if (hasWindowsLikePath(paths[index]!)) return true;
  }
  return false;
}

/** Resolve path segments to an absolute, normalized path. */
export function resolve(...paths: string[]): string {
  const windows = usesWindowsFlavor(paths);
  const pathApi = getNativePathImplementation(windows);
  return pathApi
    ? toPortableSeparators(apply(pathApi.resolve, pathApi, paths) as string)
    : portableResolve(paths, windows);
}

export function isAbsolute(path: string): boolean {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  return pathApi
    ? apply(pathApi.isAbsolute, pathApi, [path]) as boolean
    : portableIsAbsolute(path, windows);
}

export function relative(from: string, to: string): string {
  const windows = usesWindowsFlavor([from, to]);
  const pathApi = getNativePathImplementation(windows);
  const result = pathApi
    ? toPortableSeparators(apply(pathApi.relative, pathApi, [from, to]) as string)
    : portableRelative(from, to, windows);
  return result || ".";
}

export function normalize(path: string): string {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  const normalized = pathApi
    ? toPortableSeparators(apply(pathApi.normalize, pathApi, [path]) as string)
    : portableNormalize(path, windows);

  // The established Veryfront facade contract returns canonical paths without
  // a trailing separator, except for filesystem roots. Enforce that
  // postcondition independently of whether the runtime supplies node:path.
  return removeTrailingSeparatorsExceptRoot(normalized, windows);
}
