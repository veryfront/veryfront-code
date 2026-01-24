#!/usr/bin/env node
/**
 * CLI entry point for npm package
 *
 * This is a lightweight wrapper that handles cross-platform arg parsing
 * and delegates to the CLI commands.
 */

import { parseCliArgs } from "./index/arg-parser.ts";
import { routeCommand } from "./index/command-router.ts";
import { exit, getArgs } from "../platform/compat/process.ts";
import { registerHttpLoader } from "../platform/compat/register-http-loader.ts";

export async function main(): Promise<void> {
  await registerHttpLoader();
  await routeCommand(parseCliArgs(getArgs()));
}

main().catch((error) => {
  console.error("CLI Error:", error);
  exit(1);
});
