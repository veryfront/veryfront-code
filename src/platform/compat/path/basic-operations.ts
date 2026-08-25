import {
  hasWindowsLikePath,
  portableBasename,
  portableDirname,
  portableExtname,
  portableJoin,
  removeTrailingSeparatorsExceptRoot,
  runtimeUsesWindowsPaths,
  toPortableSeparators,
} from "./portable.ts";
import { getNativePathImplementation } from "./runtime.ts";

const ArrayPrototypeEvery = Array.prototype.every;
const ArrayPrototypeSome = Array.prototype.some;
const ReflectApply = Reflect.apply;

function usesWindowsFlavor(paths: readonly string[]): boolean {
  return runtimeUsesWindowsPaths() ||
    ReflectApply(ArrayPrototypeSome, paths, [hasWindowsLikePath]) as boolean;
}

/** Join and normalize path segments using their detected path flavor. */
export function join(...paths: string[]): string {
  if (
    ReflectApply(ArrayPrototypeEvery, paths, [(path: string) => path.length === 0]) as boolean
  ) return "/";
  const windows = usesWindowsFlavor(paths);
  const pathApi = getNativePathImplementation(windows);
  const joined = pathApi
    ? toPortableSeparators(pathApi.join(...paths))
    : portableJoin(paths, windows);
  return removeTrailingSeparatorsExceptRoot(joined, windows);
}

/** Return the parent directory path. */
export function dirname(path: string): string {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  return pathApi ? toPortableSeparators(pathApi.dirname(path)) : portableDirname(path, windows);
}

/** Return the last path segment. */
export function basename(path: string, ext?: string): string {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  if (!pathApi) return portableBasename(path, ext, windows);
  return ext === undefined ? pathApi.basename(path) : pathApi.basename(path, ext);
}

/** Return the file extension for a path. */
export function extname(path: string): string {
  const windows = usesWindowsFlavor([path]);
  const pathApi = getNativePathImplementation(windows);
  return pathApi?.extname(path) ?? portableExtname(path, windows);
}
