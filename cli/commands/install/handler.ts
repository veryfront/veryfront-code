/**
 * Install/Uninstall command handler
 */

import { defineSchema } from "veryfront/schemas";
import { installCommand } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getInstallArgsSchema = defineSchema((v) =>
  v.object({
    target: v.string().optional(),
    global: v.boolean().default(false),
    force: v.boolean().default(false),
  })
);

const InstallArgsSchema = getInstallArgsSchema();

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
