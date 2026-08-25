/** Dedicated compiled proxy entrypoint. Optional CLI arguments are ignored. */

import { setLoggerPreset } from "veryfront/utils/logger";
import { runStandaloneProxyRuntime } from "./commands/serve/proxy-runtime.ts";

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
