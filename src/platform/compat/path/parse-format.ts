import type { PathObject } from "./types.ts";
import {
  hasWindowsLikePath,
  portableFormat,
  portableParse,
  runtimeUsesWindowsPaths,
  toPortableSeparators,
} from "./portable.ts";
import { getNativePathImplementation } from "./runtime.ts";

export function parse(path: string): PathObject {
  const windows = runtimeUsesWindowsPaths() || hasWindowsLikePath(path);
  const pathApi = getNativePathImplementation(windows);
  if (!pathApi) return portableParse(path, windows);

  const parsed = pathApi.parse(path);
  return {
    root: toPortableSeparators(parsed.root ?? ""),
    dir: toPortableSeparators(parsed.dir ?? ""),
    base: parsed.base ?? "",
    ext: parsed.ext ?? "",
    name: parsed.name ?? "",
  };
}

export function format(pathObject: PathObject): string {
  const windows = runtimeUsesWindowsPaths() ||
    hasWindowsLikePath(pathObject.root ?? "") ||
    hasWindowsLikePath(pathObject.dir ?? "");
  const pathApi = getNativePathImplementation(windows);
  if (!pathApi) return portableFormat(pathObject, windows);

  const formatted = pathApi.format({
    root: pathObject.root ?? "",
    dir: pathObject.dir ?? "",
    base: pathObject.base ?? "",
    ext: pathObject.ext ?? "",
    name: pathObject.name ?? "",
  });
  return toPortableSeparators(formatted);
}
