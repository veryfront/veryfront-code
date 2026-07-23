import { isDeno } from "../runtime.ts";

export {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  SEPARATOR,
  toFileUrl,
} from "../path/index.ts";

const posix = isDeno
  ? await import("#std/path/posix.ts").then((path) => ({
    ...path,
    delimiter: path.DELIMITER,
    sep: path.SEPARATOR,
  }))
  : (await import("node:path")).posix;

export { posix };
