import { dirname } from "veryfront/platform/path";
import { sanitizeJobOutputForLogging } from "./sanitize-job-output.ts";

const JOB_RESULT_PATH_ENV = "VERYFRONT_JOB_RESULT_PATH";

function getJobResultPath(): string | null {
  const value = Deno.env.get(JOB_RESULT_PATH_ENV)?.trim();
  return value ? value : null;
}

export async function writeJobResultIfConfigured(value: unknown): Promise<void> {
  const resultPath = getJobResultPath();
  if (!resultPath) {
    return;
  }

  await Deno.mkdir(dirname(resultPath), { recursive: true });
  await Deno.writeTextFile(
    resultPath,
    JSON.stringify(sanitizeJobOutputForLogging(value), null, 2),
  );
}
