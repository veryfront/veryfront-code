import { isAbsolute, relative, SEPARATOR } from "#std/path";

export interface PathContainmentImplementation {
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
  separator: string;
}

const DEFAULT_PATH_CONTAINMENT_IMPLEMENTATION: PathContainmentImplementation = {
  relative,
  isAbsolute,
  separator: SEPARATOR,
};

export function isPathContained(
  root: string,
  candidate: string,
  implementation: PathContainmentImplementation =
    DEFAULT_PATH_CONTAINMENT_IMPLEMENTATION,
): boolean {
  const relativePath = implementation.relative(root, candidate);
  return relativePath === "" ||
    (!implementation.isAbsolute(relativePath) && relativePath !== ".." &&
      !relativePath.startsWith(`..${implementation.separator}`));
}
