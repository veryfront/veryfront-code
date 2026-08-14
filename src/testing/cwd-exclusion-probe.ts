/**
 * Shared body for the cross-file working-directory exclusion test.
 *
 * `withCwd` has to serialize callers across test *files*, not merely within
 * one. Under `deno test --parallel` every file runs in its own isolate, sharing
 * neither module state nor `globalThis` with its peers, while the working
 * directory it mutates belongs to the process they all share. A queue kept in
 * module state therefore orders only its own callers and lets every other file
 * race it -- which is the failure this helper exists to prevent, so it is worth
 * a test that would actually notice its return.
 *
 * Noticing it takes two real test files. One file cannot: inside a single
 * isolate the module queue is already sufficient, so the bug is invisible there
 * by construction.
 *
 * Each participant repeatedly takes the directory and, while holding it, tries
 * to create a marker exclusively. Failing to create it means someone else was
 * inside at the same moment.
 *
 * @module testing/cwd-exclusion-probe
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCwd } from "./cwd.ts";

/** Scoped to the process, which is the scope of the directory being guarded. */
const MARKER = join(tmpdir(), `veryfront-test-cwd-exclusion-${Deno.pid}`);

/** Enough turns to interleave with a peer, few enough to stay cheap. */
const ROUNDS = 5;

/** Long enough that a peer running concurrently would overlap this hold. */
const HOLD_MS = 5;

/**
 * Assert that no other test file holds the working directory while this one does.
 *
 * @param label participant name, so a failure names the side that saw the overlap
 */
export async function assertExclusiveCwd(label: string): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: `vf-cwd-exclusion-${label}-` });
  try {
    for (let round = 0; round < ROUNDS; round++) {
      await withCwd(dir, async () => {
        try {
          await Deno.writeTextFile(MARKER, label, { createNew: true });
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
          throw new Error(
            `${label} entered the working directory while another test file still held it`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        await Deno.remove(MARKER);
      });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
