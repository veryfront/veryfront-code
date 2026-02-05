/**
 * Install/Uninstall command handler
 */

import { installCommand } from "./install.ts";
import { uninstallCommand } from "./uninstall.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleInstallCommand(args: ParsedArgs): Promise<void> {
  const target = typeof args.target === "string" ? args.target : undefined;
  await installCommand({
    target,
    global: Boolean(args.global),
    force: Boolean(args.force || args.f),
  });
}

export async function handleUninstallCommand(args: ParsedArgs): Promise<void> {
  const target = typeof args.target === "string" ? args.target : undefined;
  await uninstallCommand({
    target,
    global: Boolean(args.global),
    force: Boolean(args.force || args.f),
  });
}
