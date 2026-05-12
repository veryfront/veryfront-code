import { defineSchema } from "veryfront/schemas";
import { DEFAULT_DEV_SERVER_PORT } from "#cli/utils";
import { serveCommand } from "./command.ts";
import { ServerModeSchema } from "#cli/shared/types";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

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

const ServeArgsSchema = getServeArgsSchema();

export const parseServeArgs = createArgParser(ServeArgsSchema, {
  mode: { keys: ["mode", "m"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  hostname: { keys: ["hostname", "host"], type: "string" },
  split: { keys: ["split"], type: "boolean" },
  binary: { keys: ["binary"], type: "boolean" },
  binaryPath: { keys: ["binary-path"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleServeCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseServeArgs, "serve", args);
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
