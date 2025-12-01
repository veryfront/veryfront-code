import { isDeno, nodePath } from "./runtime.ts";
import { basename, dirname, extname } from "./basic-operations.ts";
import { isAbsolute } from "./resolution.ts";
import { join } from "./basic-operations.ts";
import type { PathObject } from "./types.ts";

export function parse(path: string): PathObject {
  if (!isDeno) {
    return nodePath!.parse(path);
  }

  const dir = dirname(path);
  const base = basename(path);
  const ext = extname(path);
  const name = base.slice(0, base.length - ext.length);

  return {
    root: isAbsolute(path) ? "/" : "",
    dir,
    base,
    ext,
    name,
  };
}

export function format(pathObject: PathObject): string {
  if (!isDeno) {
    return nodePath!.format(pathObject);
  }

  const { dir = "", base = "", name = "", ext = "" } = pathObject;

  if (base) {
    return dir ? join(dir, base) : base;
  }

  const fileName = name + ext;
  return dir ? join(dir, fileName) : fileName;
}
