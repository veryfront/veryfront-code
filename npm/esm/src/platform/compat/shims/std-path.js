import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep, } from "node:path";
export function fromFileUrl(url) {
    return fileURLToPath(url);
}
export function toFileUrl(path) {
    return pathToFileURL(path);
}
export { basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep, };
export const SEPARATOR = sep;
export const SEPARATOR_PATTERN = sep === "/" ? /\/+/ : /[\\/]+/;
