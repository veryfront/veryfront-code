#!/usr/bin/env -S deno run --allow-all --unstable-kv

/**
 * Main CLI entry point
 *
 * @module cli/index/cli-main
 */

import { parseCliArgs } from "./arg-parser.ts";
import { routeCommand } from "./command-router.ts";
import { getArgs } from "../../platform/compat/process.ts";

/**
 * Main CLI function
 * Parses arguments and routes to appropriate command handler
 */
export async function main(): Promise<void> {
  const args = parseCliArgs(getArgs());
  await routeCommand(args);
}

// Run main if this is the entry point
if (import.meta.main) {
  await main();
}
