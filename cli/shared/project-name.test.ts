import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateProjectName } from "./project-name.ts";

describe("validateProjectName", () => {
  it("accepts a simple name", () => {
    assertEquals(validateProjectName("my-app"), null);
  });

  it("rejects forward slashes", () => {
    assertEquals(typeof validateProjectName("foo/bar"), "string");
  });

  it("rejects backslashes", () => {
    assertEquals(typeof validateProjectName("foo\\bar"), "string");
  });

  it("rejects dot-dot", () => {
    assertEquals(typeof validateProjectName(".."), "string");
  });

  it("rejects single dot", () => {
    assertEquals(typeof validateProjectName("."), "string");
  });

  it("accepts dotfiles", () => {
    assertEquals(validateProjectName(".my-app"), null);
  });
});
