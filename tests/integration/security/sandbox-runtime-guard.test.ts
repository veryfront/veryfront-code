// @veryfront-test runtime-guarded-deno
/**
 * SEC-008 end-to-end runtime guard for `runInWorker`.
 *
 * Why this cannot be a colocated unit test: `runInWorker` reads the operator
 * opt-in through `getHostEnv(...)` inline (src/security/sandbox/deno-sandbox.ts:113,
 * :125) and branches on the module-level `isNode` / `isBun` constants.
 * `SandboxOptions` carries no env or runtime override and the module exports no
 * testing seam, so pinning "the guard actually fires when the env var is absent"
 * requires deleting the variable from the real host environment — a `process`
 * effect that the semantic unit-boundary ratchet forbids under src/.
 *
 * The pure decision helpers (`isNodeSandboxAllowedUnsafe` /
 * `isBunSandboxAllowedUnsafe`) stay covered hermetically in
 * src/security/sandbox/deno-sandbox.test.ts; only the wiring lives here.
 *
 * These cases are runtime-gated: they assert behaviour that only exists on
 * Node.js and Bun, so they skip under Deno.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { NOT_SUPPORTED, VeryfrontError } from "#veryfront/errors";
import {
  BUN_SANDBOX_ALLOW_UNSAFE_ENV,
  NODE_SANDBOX_ALLOW_UNSAFE_ENV,
  runInWorker,
} from "#veryfront/security/sandbox/deno-sandbox.ts";

const nodeOnlyIt = isNode ? it : it.skip;
const bunOnlyIt = isBun ? it : it.skip;

/** Run `fn` with `name` absent from the host environment, then restore it. */
async function withoutHostEnv<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = getHostEnv(name);
  deleteEnv(name);
  try {
    return await fn();
  } finally {
    if (previous !== undefined) setEnv(name, previous);
  }
}

describe("sandbox runtime opt-in guard (SEC-008)", () => {
  nodeOnlyIt("refuses execution on Node.js without the opt-in env var", async () => {
    await withoutHostEnv(NODE_SANDBOX_ALLOW_UNSAFE_ENV, async () => {
      const error = await assertRejects(
        () => runInWorker("return 1;"),
        VeryfrontError,
        "not safely supported on Node.js",
        "valid code must still be refused on Node.js without an operator opt-in",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        NOT_SUPPORTED.slug,
        "the Node sandbox guard must fail closed with the registered NOT_SUPPORTED identity",
      );
    });
  });

  bunOnlyIt("refuses execution on Bun without the opt-in env var", async () => {
    await withoutHostEnv(BUN_SANDBOX_ALLOW_UNSAFE_ENV, async () => {
      const error = await assertRejects(
        () => runInWorker("return 1;"),
        VeryfrontError,
        "not safely supported on Bun",
        "valid code must still be refused on Bun without an operator opt-in",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        NOT_SUPPORTED.slug,
        "the Bun sandbox guard must fail closed with the registered NOT_SUPPORTED identity",
      );
    });
  });
});
