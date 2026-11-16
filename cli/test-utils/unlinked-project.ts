/**
 * Shared test support for commands that refuse a folder with no linked project.
 *
 * Used by the `files`, `knowledge`, `uploads` and `project` command tests so
 * each drives its real command entrypoint in the same unlinked folder. It sets
 * no environment variable and stubs no transport: the test preload already
 * removes credentials and project references from the test process, and the
 * refusal happens before any credential or request is needed.
 *
 * @module cli/test-utils/unlinked-project
 */

import { assertEquals, assertRejects } from "veryfront/testing/assert";
import { VeryfrontError } from "veryfront/errors";
import { NO_LINKED_PROJECT_MESSAGE } from "../shared/config.ts";
import type { ParsedArgs } from "../shared/types.ts";

/**
 * A folder that holds no link, config or package.json, so the only project
 * reference left is the folder name. It does not exist, so nothing is read.
 */
export const UNLINKED_PROJECT_DIR = "/nonexistent/veryfront-unlinked/code";

/** Asserts `command` stops in the unlinked folder with the no-linked-project usage error. */
export async function assertRefusesUnlinkedFolder(
  command: (args: ParsedArgs) => Promise<void>,
  args: ParsedArgs,
): Promise<void> {
  const name = args._.join(" ");
  const error = await assertRejects(
    () => command({ ...args, "project-dir": UNLINKED_PROJECT_DIR }),
    VeryfrontError,
    undefined,
    name,
  ) as VeryfrontError;
  assertEquals(error.slug, "invalid-argument", name);
  assertEquals(error.message, NO_LINKED_PROJECT_MESSAGE, name);
}
