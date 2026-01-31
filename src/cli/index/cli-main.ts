#!/usr/bin/env -S deno run --allow-all --unstable-kv

import { getArgs } from "#veryfront/platform/compat/process.ts";
import { load as loadEnv } from "#veryfront/platform/compat/std/dotenv.ts";
import { parseCliArgs } from "./arg-parser.ts";
import { routeCommand } from "./command-router.ts";

export async function main(): Promise<void> {
  // Load .env file for local development (before any command runs)
  // Works across Deno, Node.js, and Bun
  try {
    await loadEnv({ export: true, allowEmptyValues: true, examplePath: null });
  } catch {
    // .env file doesn't exist or couldn't be loaded - that's fine
  }
  const args = getArgs();
  const parsedArgs = parseCliArgs(args);
  await routeCommand(parsedArgs);
}

if (import.meta.main) {
  await main();
}
