import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { bumpDenoJsonVersion } from "./release-version.ts";

// A deno.json shaped like the real one: an inline array is what re-serialising
// used to reflow, so it has to survive a bump untouched.
const DENO_JSON = `{
  "name": "veryfront",
  "version": "0.1.1236",
  "tasks": {
    "test:node": {
      "command": "node ./tests/node/run-tests.mjs",
      "dependencies": ["build:npm"]
    },
    "test:bun": {
      "command": "node ./tests/bun/run-tests.mjs",
      "dependencies": ["build:npm"]
    }
  }
}
`;

describe("scripts/release", () => {
  describe("bumpDenoJsonVersion", () => {
    it("changes the version and nothing else", () => {
      const bumped = bumpDenoJsonVersion(DENO_JSON, "0.1.1237");

      assertStringIncludes(bumped, '"version": "0.1.1237"');
      assertEquals(
        bumped.split("\n").filter((line, index) => line !== DENO_JSON.split("\n")[index]),
        ['  "version": "0.1.1237",'],
      );
    });

    it("leaves inline arrays inline", () => {
      // The regression: JSON.stringify expanded these across three lines each,
      // so a one-line release commit arrived carrying unrelated reformatting.
      const bumped = bumpDenoJsonVersion(DENO_JSON, "0.1.1237");

      assertEquals(
        bumped.match(/"dependencies": \["build:npm"\]/g)?.length,
        2,
      );
      assertEquals(bumped.includes('"dependencies": [\n'), false);
    });

    it("keeps the file otherwise byte for byte", () => {
      const bumped = bumpDenoJsonVersion(DENO_JSON, "0.1.1237");

      assertEquals(
        bumped.replace('"version": "0.1.1237"', '"version": "0.1.1236"'),
        DENO_JSON,
      );
    });

    it("refuses a file with no version field", () => {
      assertThrows(
        () => bumpDenoJsonVersion('{\n  "name": "veryfront"\n}\n', "0.1.1237"),
        Error,
        'Could not find a "version" field',
      );
    });
  });

  describe("release ordering", () => {
    it("regenerates version artifacts before committing", async () => {
      // hydration-runtime.generated.ts embeds its own VERSION and cannot be
      // reached by the regex pass, so the generate step has to run before the
      // commit. Reordering these silently reintroduces a stale-artifact release
      // that fails generate:manifests:check on the required typecheck shard.
      const source = await Deno.readTextFile(new URL("./release.ts", import.meta.url));
      const generateAt = source.indexOf('"deno", "task", "generate"');
      const commitAt = source.indexOf('"git", "commit"');

      assertEquals(generateAt > -1, true, "release must run deno task generate");
      assertEquals(commitAt > -1, true, "release must create the commit");
      assertEquals(
        generateAt < commitAt,
        true,
        "deno task generate must run before the release commit",
      );
    });
  });
});
