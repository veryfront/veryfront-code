import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isPathContainedBy } from "#veryfront/platform/adapters/path-containment.ts";
import { readNodeFileSnapshotWithinLimit } from "#veryfront/platform/adapters/runtime/shared/node-filesystem-adapter.ts";

describe("isPathContainedBy", () => {
  it("rejects parent traversal after String.prototype.startsWith is replaced", () => {
    const originalStartsWith = Object.getOwnPropertyDescriptor(
      String.prototype,
      "startsWith",
    );
    Object.defineProperty(String.prototype, "startsWith", {
      configurable: true,
      value: () => false,
    });

    try {
      assertEquals(isPathContainedBy("/outside/secret.ts", "/project"), false);
      assertEquals(isPathContainedBy("/project/app/page.tsx", "/project"), true);
    } finally {
      Object.defineProperty(String.prototype, "startsWith", originalStartsWith!);
    }
  });

  it("reads a snapshot after Promise.all is replaced", async () => {
    const source = new Uint8Array([4, 5, 6]);
    const stat = {
      dev: 1n,
      ino: 2n,
      size: BigInt(source.byteLength),
      mtimeNs: 4n,
      ctimeNs: 5n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
    const operations = {
      realpath: (path: string) => Promise.resolve(path),
      lstat: () => Promise.resolve(stat),
      open: () =>
        Promise.resolve({
          stat: () => Promise.resolve(stat),
          read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
            buffer.set(source.subarray(position, position + length), offset);
            return Promise.resolve({ bytesRead: length });
          },
          writeFile: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }),
    };
    const descriptor = Object.getOwnPropertyDescriptor(Promise, "all");
    assertExists(descriptor);
    let poisonedCalls = 0;
    Object.defineProperty(Promise, "all", {
      ...descriptor,
      value: () => {
        poisonedCalls++;
        throw new Error("tenant Promise.all must not run");
      },
    });

    try {
      assertEquals(
        [
          ...await readNodeFileSnapshotWithinLimit(
            operations,
            "windows",
            0,
            "C:\\root\\file.bin",
            "C:\\root",
            3,
          ),
        ],
        [4, 5, 6],
      );
      assertEquals(poisonedCalls, 0);
    } finally {
      Object.defineProperty(Promise, "all", descriptor);
    }
  });
});
