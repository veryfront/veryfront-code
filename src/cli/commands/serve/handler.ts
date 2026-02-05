import { DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { serveCommand } from "./command.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleServeCommand(args: ParsedArgs): Promise<void> {
  await serveCommand({
    mode: (args.mode || args.m || "renderer") as "combined" | "proxy" | "renderer",
    port: args.port ?? DEFAULT_DEV_SERVER_PORT,
    bindAddress: String(args.hostname || args.host || "0.0.0.0"),
    splitMode: Boolean(args.split),
    useBinary: Boolean(args.binary),
    binaryPath: typeof args.binary === "string" ? args.binary : "./bin/veryfront",
    debug: Boolean(args.debug),
  });
}
