#!/usr/bin/env -S deno run --allow-all --unstable-kv

import { getArgs } from "#veryfront/platform/compat/process.ts";
import {
  hasEnvLoaded,
  loadEnv,
  markEnvLoaded,
  supportsEnvFiles,
} from "#veryfront/utils/env-loader.ts";

async function ensureEnvLoaded(): Promise<void> {
  if (hasEnvLoaded()) return;
  if (!supportsEnvFiles()) {
    markEnvLoaded();
    return;
  }

  // Load .env file for local development before importing CLI modules.
  try {
    await loadEnv();
  } catch {
    // .env file doesn't exist or couldn't be loaded - that's fine
  } finally {
    markEnvLoaded();
  }

  const { initRuntimeEnv } = await import("#veryfront/config/runtime-env.ts");
  initRuntimeEnv();
}

export async function main(): Promise<void> {
  await ensureEnvLoaded();
  const args = getArgs();
  const { parseCliArgs } = await import("./arg-parser.ts");
  const { routeCommand } = await import("./command-router.ts");
  const parsedArgs = parseCliArgs(args);
  await routeCommand(parsedArgs);
}

if (import.meta.main) {
  await main();
}
