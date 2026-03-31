import type { ParsedArgs } from "#cli/shared/types";
import { createErrorEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";

const NOT_IMPLEMENTED =
  "Rollback requires deployment history API support. This feature is coming soon.";

export async function handleRollbackCommand(
  _args: ParsedArgs,
): Promise<void> {
  if (isJsonMode()) {
    await outputJson(
      createErrorEnvelope("rollback", {
        code: "NOT_IMPLEMENTED",
        slug: "rollback-not-implemented",
        message: NOT_IMPLEMENTED,
      }),
    );
    Deno.exit(1);
    return;
  }
  console.error(`  ${NOT_IMPLEMENTED}`);
  Deno.exit(1);
}
