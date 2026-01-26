// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
import { isWindows } from "./_os.js";
export const DELIMITER = isWindows ? ";" : ":";
export const SEPARATOR = isWindows ? "\\" : "/";
export const SEPARATOR_PATTERN = isWindows ? /[\\/]+/ : /\/+/;
