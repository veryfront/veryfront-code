// Cross-runtime std/path shim (node:path + node:url)
import * as stdPath from "./shims/std-path.ts";

// Re-export common path functions with proper types
export const basename = stdPath.basename;
export const dirname = stdPath.dirname;
export const fromFileUrl = stdPath.fromFileUrl;
export const join = stdPath.join;
export const relative = stdPath.relative;
export const resolve = stdPath.resolve;
export const extname = stdPath.extname;
export const isAbsolute = stdPath.isAbsolute;
export const sep: string = stdPath.sep;
