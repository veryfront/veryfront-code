/**
 * Prototype-pollution safety for FSAdapterWrapper optional-method capture.
 *
 * These cases mutate the shared Object.prototype, so they cannot live beside
 * the colocated unit tests in src/platform/adapters/fs/wrapper.test.ts.
 */

import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { FSAdapter } from "#veryfront/platform/adapters/fs/veryfront/types.ts";

function createMockFSAdapter(): FSAdapter {
  return {
    readFile: (path: string) => {
      if (path === "/exists.txt") return Promise.resolve("content");
      return Promise.reject(new Error(`File not found: ${path}`));
    },
    exists: (path: string) => Promise.resolve(path === "/exists.txt"),
    stat: (path: string) => {
      if (path === "/exists.txt") {
        return Promise.resolve({
          size: 7,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(0),
        });
      }
      return Promise.reject(new Error(`File not found: ${path}`));
    },
  } as FSAdapter;
}

function withPollutedObjectPrototype<T>(
  key: string,
  value: unknown,
  run: () => T,
): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, { configurable: true, value });
  try {
    return run();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, original);
    }
  }
}

describe("FSAdapterWrapper optional-method capture under prototype pollution", () => {
  it("ignores a refreshSourceSnapshot planted on Object.prototype", () => {
    let planted = false;

    withPollutedObjectPrototype(
      "refreshSourceSnapshot",
      () => {
        planted = true;
        return Promise.resolve();
      },
      () => {
        const wrapper = new FSAdapterWrapper(createMockFSAdapter());

        assertEquals(
          wrapper.refreshSourceSnapshot,
          undefined,
          "a refreshSourceSnapshot planted on Object.prototype must not be captured",
        );
        assertEquals(planted, false, "the planted prototype method must never be invoked");
      },
    );
  });

  it("ignores an ensureSourceSnapshotFresh planted on Object.prototype", () => {
    let planted = false;

    withPollutedObjectPrototype(
      "ensureSourceSnapshotFresh",
      () => {
        planted = true;
        return Promise.resolve();
      },
      () => {
        const wrapper = new FSAdapterWrapper(createMockFSAdapter());

        assertEquals(
          wrapper.ensureSourceSnapshotFresh,
          undefined,
          "an ensureSourceSnapshotFresh planted on Object.prototype must not be captured",
        );
        assertEquals(planted, false, "the planted prototype method must never be invoked");
      },
    );
  });
});
