import { fileURLToPath, pathToFileURL } from "node:url";
import {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export function fromFileUrl(url: string | URL): string {
  return fileURLToPath(url);
}

export function toFileUrl(path: string): URL {
  return pathToFileURL(path);
}

export {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
};

export const SEPARATOR = sep;
