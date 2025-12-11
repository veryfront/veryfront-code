#!/usr/bin/env -S deno run --allow-all --unstable-kv


import { parseCliArgs } from "./arg-parser.ts";
import { routeCommand } from "./command-router.ts";
import { getArgs } from "../../platform/compat/process.ts";

export async function main(): Promise<void> {
  const args = parseCliArgs(getArgs());
  await routeCommand(args);
}

if (import.meta.main) {
  await main();
}
