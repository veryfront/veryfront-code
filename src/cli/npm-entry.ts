#!/usr/bin/env node

import { parseCliArgs } from "./index/arg-parser.ts";
import { routeCommand } from "./index/command-router.ts";
import { exit, getArgs } from "../platform/compat/process.ts";

export async function main(): Promise<void> {
  const args = parseCliArgs(getArgs());
  await routeCommand(args);
}

main().catch((error) => {
  console.error("CLI Error:", error);
  exit(1);
});
