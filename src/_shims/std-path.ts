import * as nodeUrl from "node:url";
import * as nodePath from "node:path";

export function fromFileUrl(url: string | URL): string {
  return nodeUrl.fileURLToPath(url);
}

export function toFileUrl(path: string): URL {
  return nodeUrl.pathToFileURL(path);
}

export const basename = nodePath.basename;
export const dirname = nodePath.dirname;
export const extname = nodePath.extname;
export const join = nodePath.join;
export const resolve = nodePath.resolve;
export const relative = nodePath.relative;
export const isAbsolute = nodePath.isAbsolute;
export const normalize = nodePath.normalize;
export const parse = nodePath.parse;
export const format = nodePath.format;
export const sep = nodePath.sep;
export const delimiter = nodePath.delimiter;

export const SEPARATOR = nodePath.sep;
export const SEPARATOR_PATTERN = nodePath.sep === "/" ? /\/+/ : /[\\/]+/;
