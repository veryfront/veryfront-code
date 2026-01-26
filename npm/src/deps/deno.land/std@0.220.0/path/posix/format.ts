// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

import { _format, assertArg } from "../_common/format.js";
import type { FormatInputPathObject } from "../_interface.js";

/**
 * Generate a path from `FormatInputPathObject` object.
 * @param pathObject with path
 */
export function format(pathObject: FormatInputPathObject): string {
  assertArg(pathObject);
  return _format("/", pathObject);
}
