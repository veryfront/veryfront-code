import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { formatGeneratedModuleEntries } from "./integrations-module-format.ts";

describe("formatGeneratedModuleEntries", () => {
  it("does not emit a dangling comma when there are no entries", () => {
    const output = formatGeneratedModuleEntries([]);

    assertEquals(output, "");
  });

  it("emits a trailing comma only when entries are present", () => {
    const output = formatGeneratedModuleEntries(["  one", "  two"]);

    assertStringIncludes(output, "  one,\n  two,");
  });
});
