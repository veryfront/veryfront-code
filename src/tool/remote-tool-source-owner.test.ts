import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource } from "./types.ts";
import { createRemoteToolSourceOwner } from "./remote-tool-source-owner.ts";

function source(id: string, dispose: () => Promise<void>): RemoteToolSource {
  return { id, listTools: async () => [], executeTool: async () => undefined, dispose };
}

describe("remote tool source owner", () => {
  it("disposes every owned source once and reports the first failure", async () => {
    const disposed: string[] = [];
    const owner = createRemoteToolSourceOwner();
    owner.own(source("one", async () => {
      disposed.push("one");
      throw new Error("first cleanup failure");
    }));
    owner.own(source("two", async () => {
      disposed.push("two");
      throw new Error("second cleanup failure");
    }));
    await assertRejects(() => owner.dispose(), Error, "first cleanup failure");
    await assertRejects(() => owner.dispose(), Error, "first cleanup failure");
    assertEquals(disposed, ["one", "two"]);
    assertThrows(() => owner.own(source("late", async () => {})), Error, "already closing");
  });

  it("rethrows the setup error after a failing cleanup", async () => {
    const owner = createRemoteToolSourceOwner();
    owner.own(source("one", async () => {
      throw new Error("cleanup failure");
    }));
    const setupError = new Error("setup failure");
    assertStrictEquals(await assertRejects(() => owner.fail(setupError)), setupError);
  });
});
