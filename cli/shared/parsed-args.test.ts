import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "./args.ts";
import type { ParsedArgs } from "./types.ts";
import { getNumberArg, getStringArg } from "./parsed-args.ts";

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

  it("converts a numeric option after the raw CLI parser preserves its string value", () => {
    const args = parseCliArgs(["issues", "list", "--limit", "20"]);

    assertEquals(args.limit, "20");
    assertEquals(getNumberArg(args, "limit"), 20);
  });

  it("rejects empty, non-numeric, and non-finite number values", () => {
    const args = {
      empty: "",
      invalid: "20ms",
      infinite: "Infinity",
    } as ParsedArgs;

    assertEquals(getNumberArg(args, "empty"), undefined);
    assertEquals(getNumberArg(args, "invalid"), undefined);
    assertEquals(getNumberArg(args, "infinite"), undefined);
  });
});
