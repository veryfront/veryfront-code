import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { runCommand } from "veryfront/platform";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { parseLintJsonOutput } from "./command.ts";

export async function handleLintCommand(_args: ParsedArgs): Promise<void> {
  const result = await runCommand("deno", {
    args: ["lint", "--json"],
    capture: true,
  });
  const stdout = result.stdout ?? "";

  if (isJsonMode()) {
    const parsed = parseLintJsonOutput(stdout, result.code);
    await outputJson(createSuccessEnvelope("lint", parsed));
  } else {
    if (result.code === 0) {
      console.log("No lint issues found.");
    } else {
      // Re-run without --json for human-readable output
      const humanResult = await runCommand("deno", {
        args: ["lint"],
        inherit: true,
      });
      exitProcess(humanResult.code);
      return;
    }
  }

  exitProcess(result.code);
}
