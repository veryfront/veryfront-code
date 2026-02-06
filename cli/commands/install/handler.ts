/**
 * Install/Uninstall command handler
 */

import { z } from "zod";
import { installCommand } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
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
  const result = parseInstallArgs(args);
  if (!result.success) {
    throw new Error(`Invalid install arguments: ${result.error.message}`);
  }
  await installCommand(result.data);
}

export async function handleUninstallCommand(args: ParsedArgs): Promise<void> {
  const result = parseInstallArgs(args);
  if (!result.success) {
    throw new Error(`Invalid uninstall arguments: ${result.error.message}`);
  }
  await uninstallCommand(result.data);
}
