import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { projectHelp } from "./command-help.ts";

describe("project runs discovery", () => {
  it("advertises SDK-backed run commands in the existing project family", () => {
    assert(projectHelp.examples?.some((example) => example.includes("project runs list")));
  });
});
