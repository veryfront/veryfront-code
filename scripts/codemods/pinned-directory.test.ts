import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loadPosixLibrary } from "./pinned-directory.ts";

describe("POSIX C library selection", () => {
  for (const arch of ["x86_64", "aarch64"]) {
    for (const available of ["libc.so.6", `/lib/ld-musl-${arch}.so.1`, "libc.so"]) {
      it(`loads ${available} on ${arch}`, () => {
        const loaded = {};
        const result = loadPosixLibrary("linux", arch, (path) => {
          if (path === available) return loaded;
          throw new Error("Library unavailable");
        });
        assertEquals(result, loaded);
      });
    }
  }

  it("keeps the Darwin system library", () => {
    assertEquals(
      loadPosixLibrary("darwin", "aarch64", (path) => path),
      "/usr/lib/libSystem.B.dylib",
    );
  });

  it("fails closed when no compatible library can load", () => {
    assertThrows(() =>
      loadPosixLibrary("linux", "aarch64", () => {
        throw new Error("Library unavailable");
      })
    );
  });
});
