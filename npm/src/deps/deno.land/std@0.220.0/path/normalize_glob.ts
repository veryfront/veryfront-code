// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

import type { GlobOptions } from "./_common/glob_to_reg_exp.js";
import { isWindows } from "./_os.js";
import { normalizeGlob as posixNormalizeGlob } from "./posix/normalize_glob.js";
import {
  normalizeGlob as windowsNormalizeGlob,
} from "./windows/normalize_glob.js";

export type { GlobOptions };

/** Like normalize(), but doesn't collapse "**\/.." when `globstar` is true. */
export function normalizeGlob(
  glob: string,
  options: GlobOptions = {},
): string {
  return isWindows
    ? windowsNormalizeGlob(glob, options)
    : posixNormalizeGlob(glob, options);
}
