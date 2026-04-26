/**
 * Test environment initialization.
 *
 * This module sets up the testing environment by disabling features
 * that can cause resource leaks in tests, like LRU cache cleanup intervals.
 *
 * IMPORTANT: Import this module before any other veryfront imports in test files
 * to ensure the flags are set before module-level caches are initialized.
 *
 * @module
 */

import { EsModuleLexer } from "@veryfront/ext-esbuild";
import { register as registerContract } from "../extensions/contracts.ts";

const g = globalThis as Record<string, unknown>;

g.__vfDisableLruInterval = true;
g.__vfTestEnv = true;
g.__vfTestEnvMask = {
  prefixes: ["VERYFRONT_", "OTEL_", "OAUTH_", "GITHUB_", "OPENAI_", "ANTHROPIC_", "GOOGLE_"],
};

// Tests don't run the extension orchestrator; prime the ModuleLexer contract
// here so transforms that depend on it (lexer.ts, parse-cache.ts) work in tests.
registerContract("ModuleLexer", new EsModuleLexer());
