/**
 * Dev command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { isAbsolute, join } from "veryfront/platform/path";
import { cwd, type HostRuntime, liveHostRuntime } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { setEnv } from "#veryfront/compat/process.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT, logWarning, showHeader } from "#cli/utils";
import { refreshLoggerConfig } from "veryfront/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import { isValidPortEnv, parsePortEnv, resolveEnvironmentPort } from "#cli/shared/port-env";
import type { ParsedArgs } from "#cli/shared/types";

const getDevArgsSchema = defineSchema((v) =>
  v.object({
    port: v.number().default(DEFAULT_DEV_SERVER_PORT),
    project: v.string().optional(),
    hmr: v.boolean().default(true),
    noHmr: v.boolean().default(false),
    open: v.boolean().default(false),
    debug: v.boolean().default(false),
  })
);

const DevArgsSchema = lazySchema(getDevArgsSchema);

const parseDevArgsBase = createArgParser(DevArgsSchema, {
  port: { keys: ["port", "p"], type: "number" },
  project: { keys: ["project"], type: "string" },
  hmr: { keys: ["hmr"], type: "boolean" },
  noHmr: { keys: ["no-hmr"], type: "boolean" },
  open: { keys: ["open"], type: "boolean" },
  debug: { keys: ["debug", "d"], type: "boolean" },
});

/**
 * Parses dev command arguments, honouring `PORT` / `VERYFRONT_PORT` as
 * lower-precedence defaults when no explicit `--port` / `-p` is given.
 */
export function parseDevArgs(
  args: ParsedArgs,
  host: HostRuntime = liveHostRuntime(),
): ReturnType<typeof parseDevArgsBase> {
  const result = parseDevArgsBase(args);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      port: args.port === undefined && args.p === undefined
        ? resolveEnvironmentPort(host, DEFAULT_DEV_SERVER_PORT)
        : result.data.port,
    },
  };
}

async function resolveProjectDir(projectArg: string | undefined): Promise<string> {
  if (projectArg) {
    const projectDir = isAbsolute(projectArg) ? projectArg : join(cwd(), projectArg);
    cliLogger.debug("Using project directory from --project flag", { projectDir });
    return projectDir;
  }

  const projectDir = cwd();
  const fs = createFileSystem();

  const configPaths = ["veryfront.config.ts", "veryfront.config.js"].map((file) =>
    join(projectDir, file)
  );

  for (const configPath of configPaths) {
    if (await fs.exists(configPath)) return projectDir;
  }

  cliLogger.debug("No veryfront config found, using defaults");
  return projectDir;
}

export async function handleDevCommand(args: ParsedArgs): Promise<void> {
  const host = liveHostRuntime();
  const opts = parseArgsOrThrow(parseDevArgs, "dev", args);
  showHeader();

  // Warn when `PORT` is set but `--port` overrides it. The developer set an
  // env var that the server is not going to use, and silent divergence is the
  // original defect this fixes. Only `PORT` is surfaced here (not
  // `VERYFRONT_PORT`) because `PORT` is the near-universal convention that
  // developers arriving from Next.js, Vite, Heroku, and Railway expect to work.
  //
  // `portExplicit` is also used to carry provenance into devCommand so that
  // `PORT=3000` is honoured even when 3000 equals the hardcoded default. The
  // sentinel `port !== 3000` check in devCommand must not swallow an explicit
  // env var that happens to equal the default value.
  const portExplicit = args.port !== undefined ||
    args.p !== undefined ||
    isValidPortEnv(host, "PORT") ||
    isValidPortEnv(host, "VERYFRONT_PORT");
  if (args.port !== undefined || args.p !== undefined) {
    const portFromEnv = parsePortEnv(host, "PORT");
    if (portFromEnv !== undefined && opts.port !== portFromEnv) {
      logWarning(
        `PORT=${portFromEnv} is set but --port ${opts.port} takes precedence`,
      );
    }
  }

  await ensureCliBundlerContracts();
  const projectDir = await resolveProjectDir(opts.project);

  // Enable verbose logging when --debug flag is passed
  if (opts.debug) {
    setEnv("LOG_LEVEL", "DEBUG");
    setEnv("VERYFRONT_DEBUG", "1");
    refreshLoggerConfig();
  }

  const { devCommand } = await import("./index.ts");
  const { done } = await devCommand({
    port: opts.port,
    portExplicit,
    projectDir,
    hmr: opts.hmr && !opts.noHmr,
    open: opts.open,
    // Clear stale ESM caches to prevent module resolution issues from previous
    // runs. devCommand does this only once it has resolved the dev port and
    // found it free. The caches are shared with any dev server already running
    // against this project.
    clearLocalCaches: true,
  });

  // Block until the dev server shuts down.
  // Without this, main.ts reaches exitProcess(0) and terminates immediately.
  await done;
}
