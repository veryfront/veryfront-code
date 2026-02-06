/**
 * Install/Uninstall command handler
 */

import { z } from "zod";
import { installCommand } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import { CommonArgs, createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const InstallArgsSchema = z.object({
  target: z.string().optional(),
  global: z.boolean().default(false),
  force: z.boolean().default(false),
});

const parseInstallArgs = createArgParser(InstallArgsSchema, {
  target: { keys: ["target"], type: "string" },
  global: { keys: ["global"], type: "boolean" },
  force: CommonArgs.force,
});

function parseArgs(args: ParsedArgs): z.infer<typeof InstallArgsSchema> {
  const result = parseInstallArgs(args);
  if (!result.success) {
    throw new Error(`Invalid install arguments: ${result.error.message}`);
  }
  return result.data;
}

export async function handleInstallCommand(args: ParsedArgs): Promise<void> {
  await installCommand(parseArgs(args));
}

export async function handleUninstallCommand(args: ParsedArgs): Promise<void> {
  await uninstallCommand(parseArgs(args));
}
