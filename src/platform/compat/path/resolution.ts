import {
  hasWindowsLikePath,
  portableIsAbsolute,
  portableNormalize,
  portableRelative,
  portableResolve,
  toPortableSeparators,
} from "./portable.ts";
import { getNativePathImplementation } from "./runtime.ts";

/** Resolve path segments to an absolute, normalized path. */
export function resolve(...paths: string[]): string {
  const windows = paths.some(hasWindowsLikePath);
  const pathApi = getNativePathImplementation(windows);
  return pathApi
    ? toPortableSeparators(pathApi.resolve(...paths))
    : portableResolve(paths, windows);
}

export function isAbsolute(path: string): boolean {
  const windows = hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  return pathApi?.isAbsolute(path) ?? portableIsAbsolute(path, windows);
}

export function relative(from: string, to: string): string {
  const windows = hasWindowsLikePath(from) || hasWindowsLikePath(to);
  const pathApi = getNativePathImplementation(windows);
  const result = pathApi
    ? toPortableSeparators(pathApi.relative(from, to))
    : portableRelative(from, to, windows);
  return result || ".";
}

export function normalize(path: string): string {
  const windows = hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  return pathApi ? toPortableSeparators(pathApi.normalize(path)) : portableNormalize(path, windows);
}
