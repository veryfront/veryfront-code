/** Dedicated compiled proxy entrypoint. Optional CLI arguments are ignored. */

// Keep the proxy's runtime-selected providers in the compile graph. Using
// `deno compile --include` for these modules embeds the workspace file tree;
// static references embed only each provider and its real dependencies.
import "../extensions/ext-auth-jwt/src/index.ts";
import "../extensions/ext-cache-redis/src/index.ts";
import "../extensions/ext-observability-opentelemetry/src/index.ts";
import "../extensions/ext-observability-sentry/src/index.ts";
import "../extensions/ext-redis/src/index.ts";

import { setLoggerPreset } from "veryfront/utils/logger";

setLoggerPreset("cli");

const { runStandaloneProxyRuntime } = await import(
  "./commands/serve/proxy-runtime.ts"
);
await runStandaloneProxyRuntime();
