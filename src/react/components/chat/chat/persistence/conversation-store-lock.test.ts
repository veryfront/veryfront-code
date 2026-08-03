import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  conversationStoreLockName,
  createBrowserConversationStoreLockRunner,
  type WebLockManagerLike,
} from "./conversation-store-lock.ts";

describe("conversation store Web Locks", () => {
  it("derives stable, injective names from the whole logical storage key", () => {
    assertEquals(
      conversationStoreLockName("a"),
      'veryfront:chat:conversation-storage:"a"',
    );
    assert(
      conversationStoreLockName("a-b") !== conversationStoreLockName("a"),
    );
    assert(
      conversationStoreLockName('a"b') !== conversationStoreLockName("a-b"),
    );
  });

  it("requests one exclusive lock and returns the critical-section result", async () => {
    const requests: Array<{ name: string; mode: string }> = [];
    const locks: WebLockManagerLike = {
      async request<T>(
        name: string,
        options: { mode: "exclusive" },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> {
        requests.push({ name, mode: options.mode });
        return await callback();
      },
    };
    const runner = createBrowserConversationStoreLockRunner(() => locks);

    assertEquals(await runner.run("store-lock", () => 42), 42);
    assertEquals(requests, [{ name: "store-lock", mode: "exclusive" }]);
  });

  it("rejects before touching storage when Web Locks is unavailable", async () => {
    let entered = false;
    const runner = createBrowserConversationStoreLockRunner(() => undefined);

    await assertRejects(
      () =>
        runner.run("store-lock", () => {
          entered = true;
        }),
      Error,
      "requires the Web Locks API",
    );
    assertEquals(entered, false);
  });

  it("does not retry unlocked when lock access or acquisition fails", async () => {
    const accessFailure = new Error("blocked lock getter");
    const inaccessible = createBrowserConversationStoreLockRunner(() => {
      throw accessFailure;
    });
    const accessError = await assertRejects(
      () => inaccessible.run("store-lock", () => undefined),
      Error,
      "could not access the Web Locks API",
    );
    assert(accessError instanceof Error);
    assertEquals(accessError.cause, accessFailure);

    let entered = false;
    const requestFailure = new Error("lock request rejected");
    const rejectingLocks: WebLockManagerLike = {
      request: () => Promise.reject(requestFailure),
    };
    const rejected = createBrowserConversationStoreLockRunner(() => rejectingLocks);
    const requestError = await assertRejects(
      () =>
        rejected.run("store-lock", () => {
          entered = true;
        }),
    );
    assertEquals(requestError, requestFailure);
    assertEquals(entered, false);
  });
});
