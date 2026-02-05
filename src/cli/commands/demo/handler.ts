/**
 * Demo command handler
 */

import type { ParsedArgs } from "../../shared/types.ts";

export async function handleDemoCommand(args: ParsedArgs): Promise<void> {
  const { demoCommand } = await import("./index.ts");
  await demoCommand({
    projectName: args._[1] ? String(args._[1]) : undefined,
    auto: Boolean(args.auto),
    loginMethod: args.login
      ? (String(args.login) as "google" | "github" | "microsoft" | "token")
      : undefined,
  });
}
