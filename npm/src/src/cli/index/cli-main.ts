#!/usr/bin/env -S deno run --allow-all --unstable-kv

import { getArgs } from "../../platform/compat/process.js";
import { parseCliArgs } from "./arg-parser.js";
import { routeCommand } from "./command-router.js";

export async function main(): Promise<void> {
  await routeCommand(parseCliArgs(getArgs()));
}

if (import.meta.main) {
  await main();
}
