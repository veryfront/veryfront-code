import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { withCwd } from "./cwd.ts";

describe("testing/cwd", () => {
  it("restores the previous directory", async () => {
    const before = Deno.cwd();
    const temp = await Deno.makeTempDir();
    try {
      await withCwd(temp, () => assert(Deno.cwd() !== before));
      assertEquals(Deno.cwd(), before);
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

  it("rejects a nested call instead of deadlocking", async () => {
    // The inner call would wait for the queue, which waits for the outer call,
    // which waits for the inner one. Failing fast turns a hung suite into a
    // named error.
    const temp = await Deno.makeTempDir();
    try {
      await assertRejects(
        () => withCwd(temp, () => withCwd(temp, () => {})),
        Error,
        "cannot be nested",
      );
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
