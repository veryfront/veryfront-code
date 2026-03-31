import type { ParsedArgs } from "#cli/shared/types";
import { createErrorEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";

const NOT_IMPLEMENTED =
  "Environment variable management requires backend API support. This feature is coming soon.";

export async function handleEnvCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args._[1] as string | undefined;

  if (isJsonMode()) {
    await outputJson(
      createErrorEnvelope("env", {
        code: "NOT_IMPLEMENTED",
        slug: "env-not-implemented",
        message: NOT_IMPLEMENTED,
      }),
    );
    Deno.exit(1);
    return;
  }

  console.error(`  ${NOT_IMPLEMENTED}`);

  if (!subcommand) {
    console.error("\n  Subcommands: list, set, remove, pull, push");
  }

  Deno.exit(1);
}
