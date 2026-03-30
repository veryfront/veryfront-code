import type { ParsedArgs } from "#cli/shared/types";
import { isJsonMode, outputJson, createSuccessEnvelope } from "../../shared/json-output.ts";
import { parseLintJsonOutput } from "./command.ts";

export async function handleLintCommand(_args: ParsedArgs): Promise<void> {
  const cmd = new Deno.Command("deno", {
    args: ["lint", "--json"],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();
  const stdout = new TextDecoder().decode(result.stdout);

  if (isJsonMode()) {
    const parsed = parseLintJsonOutput(stdout, result.code);
    await outputJson(createSuccessEnvelope("lint", parsed));
  } else {
    if (result.code === 0) {
      console.log("No lint issues found.");
    } else {
      // Re-run without --json for human-readable output
      const humanCmd = new Deno.Command("deno", {
        args: ["lint"],
        stdout: "inherit",
        stderr: "inherit",
      });
      const humanResult = await humanCmd.output();
      Deno.exit(humanResult.code);
      return;
    }
  }

  Deno.exit(result.code);
}
