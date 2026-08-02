import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { posix } from "./path.ts";

describe("platform/compat/std/path", () => {
  it("exposes an immutable POSIX namespace in every runtime", () => {
    assertEquals(Object.isFrozen(posix), true);
    assertEquals(posix.sep, "/");
    assertEquals(posix.delimiter, ":");
    assertEquals(posix.join("src", "..", "README.md"), "README.md");
  });

  it("treats backslashes as ordinary POSIX filename characters", () => {
    assertEquals(posix.basename(String.raw`C:\project\file.ts`), String.raw`C:\project\file.ts`);
    assertEquals(posix.isAbsolute(String.raw`C:\project\file.ts`), false);
    assertEquals(posix.normalize(String.raw`C:\project\file.ts`), String.raw`C:\project\file.ts`);
  });

  it("matches POSIX normalization and relative-path edge semantics", () => {
    assertEquals(posix.join(), ".");
    assertEquals(posix.join("", ""), ".");
    assertEquals(posix.normalize("/src//pages/../index.ts/"), "/src/index.ts/");
    assertEquals(posix.normalize("../../src/./index.ts"), "../../src/index.ts");
    assertEquals(posix.relative("/project/src", "/project/src"), "");
    assertEquals(posix.relative("/project/src", "/project/tests/unit"), "../tests/unit");
    assertEquals(posix.dirname("//server/file.ts"), "//server");
    assertEquals(posix.extname(".env"), "");
    assertEquals(posix.extname("archive.tar.gz"), ".gz");
  });

  it("rejects non-string runtime inputs", () => {
    assertThrows(() => posix.normalize(null as unknown as string), TypeError);
    assertThrows(() => posix.join("src", 1 as unknown as string), TypeError);
    assertThrows(() => posix.basename("file.ts", 1 as unknown as string), TypeError);
  });
});
