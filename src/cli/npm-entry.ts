#!/usr/bin/env node
/**
 * CLI entry point for npm package
 *
 * This is a lightweight wrapper that handles cross-platform arg parsing
 * and delegates to the CLI commands.
 */

import { parseCliArgs } from "./index/arg-parser.ts";
import { routeCommand } from "./index/command-router.ts";
import { getArgs, exit } from "../platform/compat/process.ts";

/**
 * Main CLI function for npm package
 */
export async function main(): Promise<void> {
  const args = parseCliArgs(getArgs());
  await routeCommand(args);
}

// Auto-run when executed directly
main().catch((error) => {
  console.error("CLI Error:", error);
  exit(1);
});
