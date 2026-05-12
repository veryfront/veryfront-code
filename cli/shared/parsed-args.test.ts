import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ParsedArgs } from "./types.ts";
import { getStringArg } from "./parsed-args.ts";

describe("cli/shared/parsed-args", () => {
  it("returns the first non-empty string value across aliases", () => {
    const args = {
      project: "",
      p: "my-project",
      "project-slug": "ignored-project",
    } as ParsedArgs;

    assertEquals(getStringArg(args, "project", "p", "project-slug"), "my-project");
  });

  it("returns undefined when no provided alias has a non-empty string", () => {
    const args = {
      project: "",
      p: false,
      "project-slug": 123,
    } as ParsedArgs;

    assertEquals(getStringArg(args, "project", "p", "project-slug"), undefined);
  });
});
