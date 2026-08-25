/**
 * Install/Uninstall command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { installCommand, isValidTargetSpec, VALID_TARGET_VALUES } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getInstallArgsSchema = defineSchema((v) =>
  v.object({
    // Validated here rather than at install time so an unknown tool id is an
    // argument error (exit 2), not a runtime failure (exit 1).
    target: v.string().optional().refine(
      (value) => value === undefined || isValidTargetSpec(value),
      { message: `unknown tool. Valid targets: ${VALID_TARGET_VALUES}` },
    ),
    global: v.boolean().default(false),
    force: v.boolean().default(false),
  })
);

const InstallArgsSchema = lazySchema(getInstallArgsSchema);

export const parseInstallArgs = createArgParser(InstallArgsSchema, {
  target: { keys: ["target", "t"], type: "string", positional: 0 },
  global: { keys: ["global", "g"], type: "boolean" },
  force: CommonArgs.force,
});

export async function handleInstallCommand(args: ParsedArgs): Promise<void> {
  await installCommand(parseArgsOrThrow(parseInstallArgs, "install", args));
}

export async function handleUninstallCommand(args: ParsedArgs): Promise<void> {
  await uninstallCommand(parseArgsOrThrow(parseInstallArgs, "uninstall", args));
}
