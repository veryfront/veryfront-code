/**
 * Dev command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { isAbsolute, join } from "veryfront/platform/path";
import { cwd, getEnv, setEnv } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { cliLogger, DEFAULT_DEV_SERVER_PORT, logWarning, showHeader } from "#cli/utils";
import { refreshLoggerConfig } from "veryfront/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import type { ParsedArgs } from "#cli/shared/types";

/**
 * Parse a port from an env var string.  Returns `undefined` when the var is
 * absent, empty, not an all-digit integer, or outside the valid port range
 * 1–65535.  Invalid values emit a warning so the developer sees exactly what
 * was rejected rather than getting a silent fallback.
 *
 * `Number.parseInt("3001abc")` silently returns 3001, so this function requires
 * the entire trimmed string to be digits before converting — no prefix parsing.
 */
function parsePortEnv(name: string): number | undefined {
  const raw = getEnv(name);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) {
    logWarning(`${name}=${JSON.stringify(raw)} is not a valid port number; ignoring`);
    return undefined;
  }
  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    logWarning(`${name}=${port} is outside the valid port range (1-65535); ignoring`);
    return undefined;
  }
  return port;
}

/**
 * Read a numeric port from an env var, returning `fallback` when the var is
 * absent or contains a value that fails strict validation (non-integer string,
 * trailing garbage, or a value outside the 1-65535 range).
 */
function readPortEnv(name: string, fallback: number): number {
  return parsePortEnv(name) ?? fallback;
}

/**
 * Returns true when the named env var holds a valid port number (all-digit
 * string within 1–65535).  This is a pure predicate — it never emits warnings,
 * because those were already emitted by `parsePortEnv` during arg parsing.
 * Used to determine whether the port came from an explicit env var rather than
 * falling through to the hardcoded default.
 */
function isValidPortEnv(name: string): boolean {
  const raw = getEnv(name);
  if (!raw) return false;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return false;
  const n = Number(t);
  return n >= 1 && n <= 65535;
}

/**
 * The default port to use for `veryfront dev`, resolved from env vars.
 *
 * Priority (highest → lowest):
 *   1. `--port` / `-p` flag — explicit, handled by `parseDevArgs`
 *   2. `PORT`              — the near-universal PaaS / framework convention
 *   3. `VERYFRONT_PORT`   — Veryfront-specific override
 *   4. 3000               — hardcoded default
 *
 * This matches how `veryfront serve` handles the same env vars, and how
 * Next.js, Vite, Create React App, Heroku, and Railway all treat `PORT`.
 */
function getDefaultDevPort(): number {
  const veryfrontPort = readPortEnv("VERYFRONT_PORT", DEFAULT_DEV_SERVER_PORT);
  return readPortEnv("PORT", veryfrontPort);
}

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
export const parseDevArgs: typeof parseDevArgsBase = (args) => {
  const result = parseDevArgsBase(args);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      port: args.port === undefined && args.p === undefined
        ? getDefaultDevPort()
        : result.data.port,
    },
  };
};

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
  const opts = parseArgsOrThrow(parseDevArgs, "dev", args);
  showHeader();

  // Warn when `PORT` is set but `--port` overrides it. The developer set an
  // env var that the server is not going to use, and silent divergence is the
  // original defect this fixes. Only `PORT` is surfaced here (not
  // `VERYFRONT_PORT`) because `PORT` is the near-universal convention that
  // developers arriving from Next.js, Vite, Heroku, and Railway expect to work.
  //
  // `portExplicit` is also used to carry provenance into devCommand so that
  // `PORT=3000` is honoured even when 3000 equals the hardcoded default — the
  // sentinel `port !== 3000` check in devCommand must not swallow an explicit
  // env var that happens to equal the default value.
  const portExplicit = args.port !== undefined ||
    args.p !== undefined ||
    isValidPortEnv("PORT") ||
    isValidPortEnv("VERYFRONT_PORT");
  if (args.port !== undefined || args.p !== undefined) {
    const portFromEnv = parsePortEnv("PORT");
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
    // found it free — the caches are shared with any dev server already running
    // against this project.
    clearLocalCaches: true,
  });

  // Block until the dev server shuts down.
  // Without this, main.ts reaches exitProcess(0) and terminates immediately.
  await done;
}
