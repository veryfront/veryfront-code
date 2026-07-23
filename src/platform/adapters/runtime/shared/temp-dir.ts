import { VeryfrontError } from "#veryfront/errors/types.ts";
import { createFileOperationError } from "./filesystem-errors.ts";
import { createNodeTempDirectory } from "#veryfront/platform/compat/temp-dir.ts";

export async function makeNodeTempDir(prefix: string): Promise<string> {
  try {
    return await createNodeTempDirectory(prefix);
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw createFileOperationError(error, "create");
  }
}
