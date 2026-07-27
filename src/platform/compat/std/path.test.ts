import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });
});
