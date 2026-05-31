import { dirname } from "veryfront/platform/path";
import { sanitizeRunOutputForLogging } from "./sanitize-run-output.ts";

const RUN_RESULT_PATH_ENV = "VERYFRONT_RUN_RESULT_PATH";

function getRunResultPath(): string | null {
  const value = Deno.env.get(RUN_RESULT_PATH_ENV)?.trim();
  return value ? value : null;
}

export async function writeRunResultIfConfigured(value: unknown): Promise<void> {
  const resultPath = getRunResultPath();
  if (!resultPath) {
    return;
  }

  await Deno.mkdir(dirname(resultPath), { recursive: true });
  await Deno.writeTextFile(
    resultPath,
    JSON.stringify(sanitizeRunOutputForLogging(value), null, 2),
  );
}
