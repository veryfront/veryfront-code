/**
 * Shared test support for commands that refuse a folder with no linked project.
 *
 * Used by the `files`, `uploads` and `project` command tests so each drives its
 * real command entrypoint in the same unlinked folder.
 *
 * @module cli/test-utils/unlinked-project
 */

import { assertEquals, assertRejects } from "veryfront/testing/assert";
import { VeryfrontError } from "veryfront/errors";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  ENVIRONMENT_PROJECT_REFERENCE_NAMES,
  NO_LINKED_PROJECT_MESSAGE,
} from "../shared/config.ts";
import type { ParsedArgs } from "../shared/types.ts";

/**
 * A folder that holds no link, config or package.json, so the only project
 * reference left is the folder name. It does not exist, so nothing is read.
 */
export const UNLINKED_PROJECT_DIR = "/nonexistent/veryfront-unlinked/code";

const ENV_NAMES = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_TOKEN_FILE",
  ...ENVIRONMENT_PROJECT_REFERENCE_NAMES,
];

/**
 * Runs `fn` with no project reference in the environment, `env` applied, and
 * every request answered with an empty list. Returns the paths it requested.
 */
export async function withUnlinkedProjectEnv(
  fn: () => Promise<void>,
  env: Record<string, string> = {},
): Promise<string[]> {
  const original = ENV_NAMES.map((name) => [name, Deno.env.get(name)] as const);
  const requests: string[] = [];
  try {
    for (const name of ENV_NAMES) Deno.env.delete(name);
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
    _resetEnvironmentConfig();
    await withMockFetch((input) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(new URL(url).pathname);
      return Promise.resolve(Response.json({ data: [] }));
    }, fn);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    _resetEnvironmentConfig();
  }
  return requests;
}

/** Asserts `command` stops in the unlinked folder with the no-linked-project usage error. */
export async function assertRefusesUnlinkedFolder(
  command: (args: ParsedArgs) => Promise<void>,
  args: ParsedArgs,
): Promise<void> {
  const name = args._.join(" ");
  const requests = await withUnlinkedProjectEnv(async () => {
    const error = await assertRejects(
      () => command({ ...args, "project-dir": UNLINKED_PROJECT_DIR }),
      VeryfrontError,
      undefined,
      name,
    ) as VeryfrontError;
    assertEquals(error.slug, "invalid-argument", name);
    assertEquals(error.message, NO_LINKED_PROJECT_MESSAGE, name);
  }, { VERYFRONT_API_KEY: "test-token" });
  assertEquals(requests, [], name);
}
