#!/usr/bin/env -S deno run --allow-all --unstable-kv

import { getArgs } from "#veryfront/platform/compat/process.ts";
import { parseCliArgs } from "./arg-parser.ts";
import { routeCommand } from "./command-router.ts";

export async function main(): Promise<void> {
  await routeCommand(parseCliArgs(getArgs()));
}

if (import.meta.main) {
  await main();
}
