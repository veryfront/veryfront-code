import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { withCwd } from "./cwd.ts";

/**
 * The working directory, or `null` when it cannot be read.
 *
 * Outside a `withCwd` turn the directory belongs to whoever holds it, and a
 * holder that has already removed its own temp directory makes `Deno.cwd()`
 * throw `NotFound`. Unreadable is still an answer here: it cannot be this
 * test's directory, because this test's directory still exists.
 */
function currentDirOrUnreadable(): string | null {
  try {
    return Deno.cwd();
  } catch {
    return null;
  }
}

describe("testing/cwd", () => {
  it("enters the requested directory and does not park the process in it", async () => {
    const temp = await Deno.makeTempDir();
    const entered = await Deno.realPath(temp);
    try {
      let inside = "";
      await withCwd(temp, () => {
        inside = Deno.cwd();
      });

      assertEquals(inside, entered, "the callback runs in the directory it asked for");
      // Deliberately not compared against a `Deno.cwd()` captured before the
      // call: reading the directory outside a turn is the unsafe move this
      // helper exists to remove, since a sibling test file may own it then.
      assertNotEquals(currentDirOrUnreadable(), entered, "the turn is handed back");
    } finally {
      await Deno.remove(temp, { recursive: true });
    }
  });

  it("serializes overlapping callers", async () => {
    const temp = await Deno.makeTempDir();
    const order: string[] = [];
    try {
      await Promise.all([
        withCwd(temp, async () => {
          order.push("a:start");
          await new Promise((r) => setTimeout(r, 5));
          order.push("a:end");
        }),
        withCwd(temp, () => void order.push("b")),
      ]);
      assertEquals(order, ["a:start", "a:end", "b"], "b must not run inside a");
    } finally {
      await Deno.remove(temp, { recursive: true });
    }
  });

  it("queues an independent caller that arrives mid-callback", async () => {
    // The caller that matters is the one that appears *while* another callback
    // is awaiting. A global "someone holds it" flag rejects that caller, which
    // is worse than the deadlock it prevents: queueing is exactly what it
    // should do.
    const temp = await Deno.makeTempDir();
    const order: string[] = [];
    let started!: () => void;
    const hasStarted = new Promise<void>((r) => (started = r));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));

    try {
      const first = withCwd(temp, async () => {
        order.push("first:start");
        started();
        await gate;
        order.push("first:end");
      });

      await hasStarted;
      const second = withCwd(temp, () => void order.push("second"));
      open();

      await Promise.all([first, second]);
      assertEquals(order, ["first:start", "first:end", "second"]);
    } finally {
      await Deno.remove(temp, { recursive: true });
    }
  });

  it("rejects a nested call instead of deadlocking", async () => {
    // The inner call would wait for the queue, which waits for the outer call,
    // which waits for the inner one. Failing fast turns a hung suite into a
    // named error.
    const temp = await Deno.makeTempDir();
    try {
      const error = await assertRejects(
        () => withCwd(temp, () => withCwd(temp, () => {})),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      // The slug is the contract; the message is free to be reworded.
      assertEquals(error.slug, "nested-cwd-scope");
      // The queue still works afterwards.
      await withCwd(temp, () => assertEquals(typeof Deno.cwd(), "string"));
    } finally {
      await Deno.remove(temp, { recursive: true });
    }
  });

  it("releases the queue when a caller throws", async () => {
    const temp = await Deno.makeTempDir();
    try {
      await assertRejects(
        () =>
          withCwd(temp, () => {
            throw new Error("boom");
          }),
        Error,
        "boom",
      );
      await withCwd(temp, () => assertEquals(typeof Deno.cwd(), "string"));
    } finally {
      await Deno.remove(temp, { recursive: true });
    }
  });
});
