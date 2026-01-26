import { hasNodePath, isDeno, nodePath } from "./runtime.js";
import { basename, dirname, extname, join } from "./basic-operations.js";
import { isAbsolute } from "./resolution.js";
import type { PathObject } from "./types.js";

export function parse(path: string): PathObject {
  if (!isDeno && hasNodePath) {
    return nodePath!.parse(path);
  }

  const dir = dirname(path);
  const base = basename(path);
  const ext = extname(path);

  return {
    root: isAbsolute(path) ? "/" : "",
    dir,
    base,
    ext,
    name: base.slice(0, base.length - ext.length),
  };
}

export function format(pathObject: PathObject): string {
  if (!isDeno && hasNodePath) {
    return nodePath!.format(pathObject);
  }

  const { dir = "", base = "", name = "", ext = "" } = pathObject;

  if (base) {
    return dir ? join(dir, base) : base;
  }

  const fileName = name + ext;
  return dir ? join(dir, fileName) : fileName;
}
