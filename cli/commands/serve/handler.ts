import { defineSchema, lazySchema } from "veryfront/schemas";
import { type HostRuntime, liveHostRuntime } from "veryfront/platform";
import { DEFAULT_DEV_SERVER_PORT } from "#cli/utils";
import { ServerModeSchema } from "#cli/shared/types";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import type { ParsedArgs } from "#cli/shared/types";

function readPortEnv(host: HostRuntime, name: string, fallback: number): number {
  const value = host.env.get(name);
  if (value === undefined) return fallback;
  const port = Number.parseInt(value, 10);
  return Number.isNaN(port) ? fallback : port;
}

function getDefaultServePort(host: HostRuntime): number {
  const veryfrontPort = readPortEnv(host, "VERYFRONT_PORT", DEFAULT_DEV_SERVER_PORT);
  return readPortEnv(host, "PORT", veryfrontPort);
}

function getDefaultBindAddress(host: HostRuntime): string {
  return host.env.get("BIND_ADDRESS")?.trim() || "0.0.0.0";
}

const getServeArgsSchema = defineSchema((v) =>
  v.object({
    mode: ServerModeSchema.default("production"),
    port: v.number().default(DEFAULT_DEV_SERVER_PORT),
    hostname: v.string().default("0.0.0.0"),
    split: v.boolean().default(false),
    binary: v.boolean().default(false),
    binaryPath: v.string().default("./bin/veryfront"),
    debug: v.boolean().default(false),
  })
);

const ServeArgsSchema = lazySchema(getServeArgsSchema);

const parseServeArgsBase = createArgParser(ServeArgsSchema, {
  mode: { keys: ["mode", "m"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  hostname: { keys: ["hostname", "host"], type: "string" },
  split: { keys: ["split"], type: "boolean" },
  binary: { keys: ["binary"], type: "boolean" },
  binaryPath: { keys: ["binary-path"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

/**
 * Parses serve command arguments, honouring `PORT` / `VERYFRONT_PORT` and
 * `BIND_ADDRESS` from the host as lower-precedence defaults when the matching
 * flags are omitted.
 */
export function parseServeArgs(
  args: ParsedArgs,
  host: HostRuntime = liveHostRuntime(),
): ReturnType<typeof parseServeArgsBase> {
  const result = parseServeArgsBase(args);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      port: args.port === undefined && args.p === undefined
        ? getDefaultServePort(host)
        : result.data.port,
      hostname: args.hostname === undefined && args.host === undefined
        ? getDefaultBindAddress(host)
        : result.data.hostname,
    },
  };
}

export async function handleServeCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseServeArgs, "serve", args);
  if (opts.split || opts.mode === "proxy") {
    await ensureCliBundlerContracts();
  }
  const { serveCommand } = await import("./command.ts");
  await serveCommand({
    mode: opts.mode as "production" | "proxy" | "combined",
    port: opts.port,
    bindAddress: opts.hostname,
    splitMode: opts.split,
    useBinary: opts.binary,
    binaryPath: opts.binaryPath,
    debug: opts.debug,
  });
}
