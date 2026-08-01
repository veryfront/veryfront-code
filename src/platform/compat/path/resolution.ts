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

function usesWindowsFlavor(paths: readonly string[]): boolean {
  return runtimeUsesWindowsPaths() || paths.some(hasWindowsLikePath);
}

/** Resolve path segments to an absolute, normalized path. */
export function resolve(...paths: string[]): string {
  const windows = usesWindowsFlavor(paths);
  const pathApi = getNativePathImplementation(windows);
  return pathApi
    ? toPortableSeparators(pathApi.resolve(...paths))
    : portableResolve(paths, windows);
}

export function isAbsolute(path: string): boolean {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  return pathApi?.isAbsolute(path) ?? portableIsAbsolute(path, windows);
}

export function relative(from: string, to: string): string {
  const windows = usesWindowsFlavor([from, to]);
  const pathApi = getNativePathImplementation(windows);
  const result = pathApi
    ? toPortableSeparators(pathApi.relative(from, to))
    : portableRelative(from, to, windows);
  return result || ".";
}

export function normalize(path: string): string {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  const normalized = pathApi
    ? toPortableSeparators(pathApi.normalize(path))
    : portableNormalize(path, windows);

  // The established Veryfront facade contract returns canonical paths without
  // a trailing separator, except for filesystem roots. Enforce that
  // postcondition independently of whether the runtime supplies node:path.
  return removeTrailingSeparatorsExceptRoot(normalized, windows);
}
