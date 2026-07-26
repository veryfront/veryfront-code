import type { RuntimeId } from "./base.ts";
import { runtimeKind } from "../compat/runtime.ts";

export function detectRuntime(): RuntimeId | "unknown" {
  return runtimeKind;
}
