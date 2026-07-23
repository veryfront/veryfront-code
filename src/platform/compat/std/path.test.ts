import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse, posix } from "./path.ts";

describe("platform/compat/std/path", () => {
  it("exports the platform path parser", () => {
    assertEquals(parse("/project/file.ts").base, "file.ts");
  });

  it("exports a usable POSIX path namespace", () => {
    assertEquals(posix.join("project", "generated", "..", "file.ts"), "project/file.ts");
    assertEquals(posix.sep, "/");
  });
});
