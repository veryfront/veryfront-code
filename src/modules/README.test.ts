import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("modules README", () => {
  it("passes an explicit render mode to the component loader", async () => {
    const readme = await Deno.readTextFile(
      new URL("./README.md", import.meta.url),
    );
    const example = readme.split("### Load a component from source", 2)[1]
      ?.split("###", 1)[0] ?? "";

    assertStringIncludes(example, "dev: false");
  });
});
