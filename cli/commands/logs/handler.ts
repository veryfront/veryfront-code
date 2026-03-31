import type { ParsedArgs } from "#cli/shared/types";
import { createErrorEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";

const NOT_IMPLEMENTED = "Log streaming requires a backend endpoint. This feature is coming soon.";

export async function handleLogsCommand(_args: ParsedArgs): Promise<void> {
  if (isJsonMode()) {
    await outputJson(
      createErrorEnvelope("logs", {
        code: "NOT_IMPLEMENTED",
        slug: "logs-not-implemented",
        message: NOT_IMPLEMENTED,
      }),
    );
    Deno.exit(1);
    return;
  }
  console.error(`  ${NOT_IMPLEMENTED}`);
  Deno.exit(1);
}
