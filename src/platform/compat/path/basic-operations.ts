import {
  hasWindowsLikePath,
  portableBasename,
  portableDirname,
  portableExtname,
  portableJoin,
  toPortableSeparators,
} from "./portable.ts";
import { getNativePathImplementation } from "./runtime.ts";

/** Join and normalize path segments using their detected path flavor. */
export function join(...paths: string[]): string {
  if (paths.every((path) => path.length === 0)) return "/";
  const windows = paths.some(hasWindowsLikePath);
  const pathApi = getNativePathImplementation(windows);
  return pathApi ? toPortableSeparators(pathApi.join(...paths)) : portableJoin(paths, windows);
}

/** Return the parent directory path. */
export function dirname(path: string): string {
  const windows = hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  return pathApi ? toPortableSeparators(pathApi.dirname(path)) : portableDirname(path, windows);
}

/** Return the last path segment. */
export function basename(path: string, ext?: string): string {
  const windows = hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  if (!pathApi) return portableBasename(path, ext, windows);
  return ext === undefined ? pathApi.basename(path) : pathApi.basename(path, ext);
}

/** Return the file extension for a path. */
export function extname(path: string): string {
  const windows = hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  return pathApi?.extname(path) ?? portableExtname(path, windows);
}
