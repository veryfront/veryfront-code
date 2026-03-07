/**
 * Auth Utilities
 *
 * Shared utilities for authentication-related CLI operations.
 */

import type { AuthMethod } from "./login.ts";
import type { ParsedArgs } from "../shared/types.ts";

/**
 * Parse login method from CLI arguments
 */
export function parseLoginMethod(
  args: ParsedArgs,
): AuthMethod | undefined {
  if (args.google) return "google";
  if (args.github) return "github";
  if (args.microsoft) return "microsoft";
  if (args.token) return "token";
  return undefined;
}
