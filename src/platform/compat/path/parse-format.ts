import { basename, dirname, extname, join } from "./basic-operations.ts";
import { canonicalizeSeparators, parsePathRoot } from "./internals.ts";
import type { PathObject } from "./types.ts";

export function parse(path: string): PathObject {
  const canonicalPath = canonicalizeSeparators(path);
  const dir = dirname(canonicalPath);
  const base = basename(canonicalPath);
  const ext = extname(canonicalPath);

  return {
    root: parsePathRoot(canonicalPath).root,
    dir,
    base,
    ext,
    name: base.slice(0, base.length - ext.length),
  };
}

export function format(pathObject: PathObject): string {
  const { root = "", dir = "", base = "", name = "", ext = "" } = pathObject;

  const fileName = base || name + ext;
  const directory = canonicalizeSeparators(dir || root);
  if (!directory) return fileName;
  if (!fileName) return directory;
  return directory.endsWith("/") ? `${directory}${fileName}` : join(directory, fileName);
}
