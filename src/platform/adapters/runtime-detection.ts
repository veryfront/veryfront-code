import type { RuntimeId } from "./base.ts";
import { isBun, isCloudflare, isDeno, isNode } from "../compat/runtime.ts";

export function detectRuntime(): RuntimeId | "unknown" {
  if (isDeno) return "deno";
  if (isBun) return "bun";
  if (isNode) return "node";
  if (isCloudflare) return "cloudflare";
  return "unknown";
}
