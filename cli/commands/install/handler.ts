/**
 * Install/Uninstall command handler
 */

import { z } from "zod";
import { installCommand } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const InstallArgsSchema = z.object({
  target: z.string().optional(),
  global: z.boolean().default(false),
  force: z.boolean().default(false),
});

export const parseInstallArgs = createArgParser(InstallArgsSchema, {
  target: { keys: ["target", "t"], type: "string" },
  global: { keys: ["global", "g"], type: "boolean" },
  force: CommonArgs.force,
});

export async function handleInstallCommand(args: ParsedArgs): Promise<void> {
  await installCommand(parseArgsOrThrow(parseInstallArgs, "install", args));
}

export async function handleUninstallCommand(args: ParsedArgs): Promise<void> {
  await uninstallCommand(parseArgsOrThrow(parseInstallArgs, "uninstall", args));
}
