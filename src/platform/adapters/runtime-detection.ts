/**
 * Runtime Detection - Standalone module to avoid circular dependencies
 *
 * This module detects the current runtime environment without importing
 * from detect.ts or registry.ts, breaking the circular dependency.
 */

import type { RuntimeId } from "./base.ts";
import { isBun, isCloudflare, isDeno, isNode } from "../compat/runtime.ts";

/**
 * Detect the current runtime environment
 * @returns Runtime identifier
 */
export function detectRuntime(): RuntimeId | "unknown" {
  if (isDeno) return "deno";
  if (isBun) return "bun";
  if (isNode) return "node";
  if (isCloudflare) return "cloudflare";
  return "unknown";
}
