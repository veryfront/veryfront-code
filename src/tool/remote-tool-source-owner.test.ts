import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource } from "./types.ts";
import {
  createRemoteToolSourceOwner,
  disposeRemoteToolSources,
} from "./remote-tool-source-owner.ts";

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

  it("disposes independent sources concurrently", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => release = resolve);
    const owner = createRemoteToolSourceOwner();
    for (const id of ["one", "two"]) {
      owner.own(source(id, async () => {
        started.push(id);
        await gate;
      }));
    }
    const disposing = owner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(started, ["one", "two"]);
    release();
    await disposing;
  });

  it("disposes a shared constituent once and survives a synchronous dispose failure", async () => {
    let disposed = 0;
    const shared = source("shared", async () => {
      disposed++;
    });
    const broken: RemoteToolSource = {
      ...source("broken", async () => {}),
      dispose: () => {
        throw new Error("sync failure");
      },
    };
    await assertRejects(
      () => disposeRemoteToolSources([broken, shared, shared]),
      Error,
      "sync failure",
    );
    assertEquals(disposed, 1);
  });
});
