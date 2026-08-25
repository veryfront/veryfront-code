import { parse } from "#std/yaml/parse";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const CONFIG_PATH = ".github/secret_scanning.yml";
const KNOWN_FALSE_POSITIVE_FIXTURES = [
  "src/utils/logger/logger.test.ts",
  "storybook/stories/ui/Input.stories.tsx",
];

describe("secret scanning path exclusions", () => {
  it("limits exclusions to known false-positive fixtures", async () => {
    const config = parse(await Deno.readTextFile(CONFIG_PATH));
    assert(config && typeof config === "object" && !Array.isArray(config));

    const paths = (config as Record<string, unknown>)["paths-ignore"];
    assert(Array.isArray(paths));
    assertEquals(paths, KNOWN_FALSE_POSITIVE_FIXTURES);
  });
});
