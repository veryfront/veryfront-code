#!/usr/bin/env -S deno run --allow-all --unstable-kv

import { getArgs } from "#veryfront/platform/compat/process.ts";
import { parseCliArgs } from "./arg-parser.ts";
import { routeCommand } from "./command-router.ts";

export async function main(): Promise<void> {
  const args = getArgs();
  const parsedArgs = parseCliArgs(args);
  await routeCommand(parsedArgs);
}

if (import.meta.main) {
  await main();
}
