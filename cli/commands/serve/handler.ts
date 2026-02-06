import { z } from "zod";
import { DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { serveCommand } from "./command.ts";
import { ServerModeSchema } from "#cli/shared/types";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const ServeArgsSchema = z.object({
  mode: ServerModeSchema.default("renderer"),
  port: z.number().default(DEFAULT_DEV_SERVER_PORT),
  hostname: z.string().default("0.0.0.0"),
  split: z.boolean().default(false),
  binary: z.boolean().default(false),
  binaryPath: z.string().default("./bin/veryfront"),
  debug: z.boolean().default(false),
});

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
  const result = parseServeArgs(args);
  if (!result.success) {
    throw new Error(`Invalid serve arguments: ${result.error.message}`);
  }
  const opts = result.data;
  await serveCommand({
    mode: opts.mode,
    port: opts.port,
    bindAddress: opts.hostname,
    splitMode: opts.split,
    useBinary: opts.binary,
    binaryPath: opts.binaryPath,
    debug: opts.debug,
  });
}
