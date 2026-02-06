import { z } from "zod";
import { DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { serveCommand } from "./command.ts";
import { createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const ServeArgsSchema = z.object({
  mode: z.enum(["combined", "proxy", "renderer"]).default("renderer"),
  port: z.number().default(DEFAULT_DEV_SERVER_PORT),
  bindAddress: z.string().default("0.0.0.0"),
  splitMode: z.boolean().default(false),
  useBinary: z.boolean().default(false),
  debug: z.boolean().default(false),
});

const parseServeArgs = createArgParser(ServeArgsSchema, {
  mode: { keys: ["mode", "m"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  bindAddress: { keys: ["hostname", "host"], type: "string" },
  splitMode: { keys: ["split"], type: "boolean" },
  useBinary: { keys: ["binary"], type: "boolean" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleServeCommand(args: ParsedArgs): Promise<void> {
  const result = parseServeArgs(args);
  if (!result.success) {
    throw new Error(`Invalid serve arguments: ${result.error.message}`);
  }

  // --binary can be a string path or just a boolean flag
  const binaryPath = typeof args.binary === "string" ? args.binary : "./bin/veryfront";

  await serveCommand({
    ...result.data,
    binaryPath,
  });
}
