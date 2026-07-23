import type { RuntimeId } from "./base.ts";
import { detectRuntimeEnvironment } from "../compat/runtime.ts";

export function detectRuntime(): RuntimeId | "unknown" {
  return detectRuntimeEnvironment();
}
