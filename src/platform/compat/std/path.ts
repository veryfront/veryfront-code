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

interface PosixPath {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  sep: string;
  delimiter: string;
}

function freezePosixPath(
  implementation: Omit<PosixPath, "sep" | "delimiter">,
): Readonly<PosixPath> {
  return Object.freeze({
    join: (...paths: string[]) => implementation.join(...paths),
    resolve: (...paths: string[]) => implementation.resolve(...paths),
    normalize: (path: string) => implementation.normalize(path),
    relative: (from: string, to: string) => implementation.relative(from, to),
    dirname: (path: string) => implementation.dirname(path),
    basename: (path: string, ext?: string) => implementation.basename(path, ext),
    extname: (path: string) => implementation.extname(path),
    isAbsolute: (path: string) => implementation.isAbsolute(path),
    sep: "/",
    delimiter: ":",
  });
}

async function loadPosixPath(): Promise<Readonly<PosixPath>> {
  if (isDeno) {
    return freezePosixPath(await import("#std/path/posix"));
  }
  return freezePosixPath((await import("node:path")).posix);
}

export const posix = await loadPosixPath();
