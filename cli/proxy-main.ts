/** Dedicated compiled proxy entrypoint. Optional CLI arguments are ignored. */

import { setLoggerPreset } from "#cli/logger-config";
import { runStandaloneProxyRuntime } from "./commands/serve/proxy-runtime.ts";

// `deno compile` freezes the npm set of the lockfile it resolved against, and
// THIS entrypoint is the only one compiled with
// `--lock scripts/build/proxy-deno.lock` (createCompileArgs in
// scripts/build/compile-binary.ts). `runStandaloneProxyRuntime` is shared with
// `veryfront serve --mode=proxy` on the full binary, so this file is the only
// place the two profiles are distinguishable.
//
// src/discovery is inside this module graph, so without the marker the
// discovery bundler claims the full binary's npm set on a binary that froze a
// quarter of it, and leaves hundreds of packages external that this binary
// cannot resolve. Set at module scope, before anything can run discovery.
//
// The name is written out rather than imported because cli/ may not deep-import
// framework internals (scripts/lint/enforce-cli-boundary.ts) and this flag has
// no public `veryfront/*` export. It is `PROXY_BINARY_PROFILE_GLOBAL` in
// src/discovery/project-npm-imports.ts, and
// tests/unit/build/compile-binary-includes.test.ts asserts the two agree.
(globalThis as Record<string, unknown>).__VERYFRONT_PROXY_BINARY_PROFILE__ = true;

// Keep the proxy's runtime-selected providers in the compile graph. Using
// `deno compile --include` for these modules embeds the workspace file tree;
// static references embed only each provider and its real dependencies.
// ext-schema-zod is loaded through the same dynamic first-party import as the
// rest, so without its static anchor `ensureCliSchemaValidator` resolves in
// source checkouts and fails inside the compiled binary.
import "../extensions/ext-auth-jwt/src/index.ts";
import "../extensions/ext-cache-redis/src/index.ts";
import "../extensions/ext-observability-opentelemetry/src/index.ts";
import "../extensions/ext-observability-sentry/src/index.ts";
import "../extensions/ext-redis/src/index.ts";
import "../extensions/ext-schema-zod/src/index.ts";

setLoggerPreset("cli");

await runStandaloneProxyRuntime();
